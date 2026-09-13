/**
 * The workspace's two model settings as a service (VS-77, ADR 0011): read them, change one, and
 * settle the question a mixed-runtime migration left open.
 */
import { DEFAULT_MODEL_SETTING, OcError, WorkspaceModelsSchema, type EffectiveModels, type WorkspaceModels, type WorkspaceModelsPut, type WorkspaceModelsView } from '@weave-ai/shared';
import type { Db } from '@weave-ai/db';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, ModelsService } from '../api.js';
import { recordActivity } from '../events.js';
import { releaseLoginPausesForAbandonedRuntimes } from '../runs/authgate.js';
import { migrationSummary, type ModelMigration } from './migrate.js';

export { effectiveModels, modelSettingFor, modelsFor, modelsSource, workerOptionRuntimes } from './resolve.js';
import { effectiveModels, modelsSource } from './resolve.js';
export { demaskWorkspaceModels, deriveModelSettings, hasModelSettings, migrationSummary, type DemaskResult, type ModelMigration, type RoleRuntimeRow, type WorkersRule } from './migrate.js';

/** The `meta` row migration 0012 leaves behind: what the roles were running on before it dropped the columns. */
export const ROLE_RUNTIMES_META_KEY = 'vs77_role_runtimes';

/** Where the loader leaves a migration whose workers runtime was picked rather than settled. */
export const MIGRATION_SETTINGS_KEY = 'modelsMigration';
/** One open card per workspace, however often the daemon restarts. */
export const WORKERS_RUNTIME_CORRELATION = 'models:workers-runtime';

interface PendingMigration { ambiguous?: boolean; counts?: Array<{ runtime: string; roles: number }>; chosen?: string }

function readPending(ctx: WorkspaceContext): PendingMigration | null {
  const row = ctx.db.get<{ settings: Record<string, unknown> | null }>('SELECT settings_json FROM workspaces WHERE id = ?', [ctx.workspaceId]);
  const pending = (row?.settings ?? {})[MIGRATION_SETTINGS_KEY] as PendingMigration | undefined;
  return pending?.ambiguous === true ? pending : null;
}

function writeSettings(db: Db, workspaceId: string, mutate: (s: Record<string, unknown>) => void): void {
  const row = db.get<{ settings: Record<string, unknown> | null }>('SELECT settings_json FROM workspaces WHERE id = ?', [workspaceId]);
  const settings = { ...(row?.settings ?? {}) };
  mutate(settings);
  db.update('workspaces', workspaceId, { settingsJson: settings });
}

/**
 * Record that a migration could not settle the workers runtime by itself. Written by the loader,
 * which runs before any service exists; `reconcile()` turns it into a card at startup.
 */
export function recordPendingMigration(db: Db, workspaceId: string, m: ModelMigration): void {
  writeSettings(db, workspaceId, (s) => {
    s[MIGRATION_SETTINGS_KEY] = { ambiguous: true, counts: m.counts, chosen: m.models.workers.runtime };
  });
}

export function createModelsService(ctx: WorkspaceContext, deps: () => CoreServices): ModelsService {
  const log = ctx.log('daemon');

  /** The effective values plus each control's source (VS-356). */
  const view = (): WorkspaceModelsView => ({
    ...effectiveModels(ctx.daemon, ctx.config),
    source: modelsSource(ctx.daemon, ctx.config),
  });

  const service: ModelsService = {
    get(): WorkspaceModelsView {
      return view();
    },

    async set(actor: Actor, next: WorkspaceModelsPut | EffectiveModels): Promise<WorkspaceModelsView> {
      // VS-284: a workspace's own setting always wins over a daemon overlay now, so a write here
      // is never refused or silently discarded on the daemon's account — it always writes what
      // was asked, exactly as any other workspace config write does.
      // VS-356: each control is independent. `undefined`/omitted keeps what is stored, `null`
      // clears it back to inherit, a value overrides. `workerOptions` `null`/`[]` clears the
      // catalog so the workspace inherits the daemon's.
      const stored = ctx.config.models;
      const merged: WorkspaceModels = {
        workerOptions: next.workerOptions === undefined ? (stored.workerOptions ?? []) : (next.workerOptions ?? []),
      };
      const weaver = next.weaver === undefined ? stored.weaver : (next.weaver ?? undefined);
      const workers = next.workers === undefined ? stored.workers : (next.workers ?? undefined);
      if (weaver !== undefined) merged.weaver = weaver;
      if (workers !== undefined) merged.workers = workers;
      const parsed = WorkspaceModelsSchema.safeParse(merged);
      if (!parsed.success) {
        throw new OcError('validation', `invalid model settings: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      const before = ctx.config.models;
      await ctx.saveConfig({ ...ctx.config, models: parsed.data });
      // The conductor's row records the runtime it is on; correcting it here means the change is
      // visible before its next turn, and `forTurn` retires a session the old runtime issued.
      try { await deps().workers.ensureConductor(); } catch (e) { log.warn({ err: String(e) }, 'could not restamp the conductor after a model change'); }
      // A move off a dead runtime must also lift the login pauses that runtime raised — they
      // guard turns that will never be taken on it again (VS-75 meets VS-77).
      try { releaseLoginPausesForAbandonedRuntimes(ctx, deps); } catch (e) { log.warn({ err: String(e) }, 'could not release login pauses for abandoned runtimes'); }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'workspace.models_changed', 'workspace', ctx.workspaceId, { before, after: parsed.data });
      ctx.events.emit('workspace.updated', 'workspace', ctx.workspaceId, { models: parsed.data });
      log.info({ before, after: parsed.data }, 'model settings changed');
      return view();
    },

    reconcile(): void {
      // The startup sweep for workspaces that moved off a dead runtime while its agents were
      // login-paused: their pauses outlived the runtime that raised them and nothing else lifts
      // those. Runs before the pending-migration card so both can be settled in one start.
      try { releaseLoginPausesForAbandonedRuntimes(ctx, deps); } catch (e) { log.error({ err: String(e) }, 'could not release login pauses for abandoned runtimes'); }
      const pending = readPending(ctx);
      if (!pending) return;
      const chosen = pending.chosen ?? effectiveModels(ctx.daemon, ctx.config).workers.runtime;
      const counts = pending.counts ?? [];
      // One card per workspace, and a restart must not replace it with a fresh one: `create` would
      // supersede the open card and raise a second, so an existing one ends the turn here.
      const open = deps().decisions.list({ status: ['open'] }).some((d) => d.correlationKey === WORKERS_RUNTIME_CORRELATION);
      if (open) return;
      try {
        deps().decisions.create({ kind: 'system', id: null }, {
          kind: 'question', owner: 'human',
          title: 'Which runtime should this workspace\'s workers use?',
          context: [
            'This workspace was set up when a runtime was chosen per role, and its roles did not agree:',
            counts.map((c) => `- ${c.runtime}: ${c.roles} role${c.roles === 1 ? '' : 's'}`).join('\n'),
            `Every worker now runs on one workspace setting. \`${chosen}\` is in force because the most roles used it — confirm it or pick another. The conductor's own runtime is separate and was not changed.`,
          ].join('\n\n'),
          options: counts.map((c) => ({ key: `runtime:${c.runtime}`, label: `Run workers on ${c.runtime}`, recommended: c.runtime === chosen })),
          recommendation: `runtime:${chosen}`,
          correlationKey: WORKERS_RUNTIME_CORRELATION,
        });
      } catch (e) {
        // A card that could not be raised leaves the flag set, so the next start tries again.
        log.error({ err: String(e) }, 'could not ask which runtime the workers setting should hold');
        return;
      }
      log.info({ chosen, counts }, 'asked which runtime the workers setting should hold');
    },

    async settleWorkersRuntime(actor: Actor, runtime: string): Promise<EffectiveModels> {
      // This only runs to answer the "roles disagreed" migration card, so the workspace already
      // has a concrete (if just-derived) workers setting in the normal case; the
      // `DEFAULT_MODEL_SETTING` fallback covers the case where a VS-284 demasking pass cleared it
      // because the daemon also held an overlay — the human is now making a deliberate choice,
      // which is exactly what should win.
      const models = await service.set(actor, { ...ctx.config.models, weaver: effectiveModels(ctx.daemon, ctx.config).weaver, workers: { ...(ctx.config.models.workers ?? DEFAULT_MODEL_SETTING), runtime } });
      writeSettings(ctx.db, ctx.workspaceId, (s) => { delete s[MIGRATION_SETTINGS_KEY]; });
      return models;
    },
  };
  return service;
}

/** The structured half of the log line the loader writes once it has derived the two settings. */
export function migrationLogFields(m: ModelMigration): Record<string, unknown> {
  return { weaver: m.models.weaver, workers: m.models.workers, roleRuntimes: m.counts, rule: m.rule };
}
