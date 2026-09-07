/**
 * The workspace's two model settings as a service (VS-77, ADR 0011): read them, change one, and
 * settle the question a mixed-runtime migration left open.
 */
import { OcError, WorkspaceModelsSchema, type WorkspaceModels } from '@agent-conductor/shared';
import type { Db } from '@agent-conductor/db';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, ModelsService } from '../api.js';
import { recordActivity } from '../events.js';
import { migrationSummary, type ModelMigration } from './migrate.js';

export { modelSettingFor } from './resolve.js';
export { deriveModelSettings, hasModelSettings, migrationSummary, type ModelMigration, type RoleRuntimeRow, type WorkersRule } from './migrate.js';

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

  const service: ModelsService = {
    get(): WorkspaceModels {
      return ctx.config.models;
    },

    async set(actor: Actor, next: WorkspaceModels): Promise<WorkspaceModels> {
      const parsed = WorkspaceModelsSchema.safeParse(next);
      if (!parsed.success) {
        throw new OcError('validation', `invalid model settings: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      const before = ctx.config.models;
      await ctx.saveConfig({ ...ctx.config, models: parsed.data });
      // The conductor's row records the runtime it is on; correcting it here means the change is
      // visible before its next turn, and `forTurn` retires a session the old runtime issued.
      try { await deps().workers.ensureConductor(); } catch (e) { log.warn({ err: String(e) }, 'could not restamp the conductor after a model change'); }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'workspace.models_changed', 'workspace', ctx.workspaceId, { before, after: parsed.data });
      ctx.events.emit('workspace.updated', 'workspace', ctx.workspaceId, { models: parsed.data });
      log.info({ before, after: parsed.data }, 'model settings changed');
      return parsed.data;
    },

    reconcile(): void {
      const pending = readPending(ctx);
      if (!pending) return;
      const chosen = pending.chosen ?? ctx.config.models.workers.runtime;
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

    async settleWorkersRuntime(actor: Actor, runtime: string): Promise<WorkspaceModels> {
      const models = await service.set(actor, { ...ctx.config.models, workers: { ...ctx.config.models.workers, runtime } });
      writeSettings(ctx.db, ctx.workspaceId, (s) => { delete s[MIGRATION_SETTINGS_KEY]; });
      return models;
    },
  };
  return service;
}

/** The structured half of the log line the loader writes once it has derived the two settings. */
export function migrationLogFields(m: ModelMigration): Record<string, unknown> {
  return { conductor: m.models.conductor, workers: m.models.workers, roleRuntimes: m.counts, rule: m.rule };
}
