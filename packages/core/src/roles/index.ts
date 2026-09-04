import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, RoleSpecSchema, type Role, type RoleSpec, type Project } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, RolesService } from '../api.js';
import { recordActivity } from '../events.js';
import { renderCharter } from '../prompts/index.js';

const LIVE_WORKER_STATUSES = "('provisioning','active','running','paused','error')";

function roleDir(ctx: WorkspaceContext, id: string): string { return join(ctx.paths.roles, id); }

export function readRoleSpec(ctx: WorkspaceContext, id: string): RoleSpec | null {
  const path = join(roleDir(ctx, id), 'role.yaml');
  if (!existsSync(path)) return null;
  const parsed = RoleSpecSchema.safeParse(YAML.parse(readFileSync(path, 'utf8')));
  return parsed.success ? parsed.data : null;
}

function writeRoleFiles(ctx: WorkspaceContext, spec: RoleSpec, charter?: string): void {
  const dir = roleDir(ctx, spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'role.yaml'), YAML.stringify(spec, { lineWidth: 0 }), 'utf8');
  const charterPath = join(dir, 'CHARTER.md');
  if (charter !== undefined) writeFileSync(charterPath, charter, 'utf8');
  else if (!existsSync(charterPath)) writeFileSync(charterPath, renderCharter(ctx, spec), 'utf8');
}

function rowToSpec(ctx: WorkspaceContext, role: Role): RoleSpec {
  const fromFile = readRoleSpec(ctx, role.id);
  const project = ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [role.projectId]);
  return RoleSpecSchema.parse({
    ...(fromFile ?? {}),
    id: role.id, name: role.name, project: project?.slug ?? fromFile?.project ?? 'unknown',
    title: role.title ?? undefined, icon: role.icon ?? undefined,
    charterSummary: role.charterSummary, scope: role.scopeText,
    responsibilities: role.responsibilities, capabilities: role.capabilities, rules: role.rules,
    runtime: role.runtimeId, model: role.model, effort: role.effort ?? undefined,
    sessionPolicy: role.sessionPolicy, maxWorkers: role.maxWorkers,
    permission: role.permission, secrets: role.secrets, createdBy: role.createdBy,
  });
}

export function createRolesService(ctx: WorkspaceContext, deps: () => CoreServices): RolesService {
  const log = ctx.log('daemon');

  const get = (id: string): Role => {
    const r = ctx.db.get<Role>('SELECT * FROM roles WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
    if (!r) throw new OcError('not_found', `role ${id} not found`);
    return r;
  };

  const liveWorkers = (roleId: string): number =>
    ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM agents WHERE role_id = ? AND status IN ${LIVE_WORKER_STATUSES}`, [roleId])?.n ?? 0;

  const writeRevision = (roleId: string, before: unknown, after: unknown, author: string, reason: string, changedKeys: string[]): number => {
    const last = ctx.db.get<{ revision: number }>('SELECT MAX(revision) revision FROM role_revisions WHERE role_id = ?', [roleId]);
    const revision = (last?.revision ?? 0) + 1;
    ctx.db.insert('role_revisions', { id: newId(), roleId, revision, changedKeysJson: changedKeys, beforeJson: before ?? {}, afterJson: after ?? {}, author, reason, createdAt: nowIso() });
    return revision;
  };

  const persistSpec = (role: Role, spec: RoleSpec, charter?: string): Role => {
    writeRoleFiles(ctx, spec, charter);
    ctx.db.update('roles', role.id, {
      name: spec.name, title: spec.title ?? null, icon: spec.icon ?? null, charterSummary: spec.charterSummary, scopeText: spec.scope,
      responsibilitiesJson: spec.responsibilities, capabilitiesJson: spec.capabilities, rulesJson: spec.rules,
      runtimeId: spec.runtime, model: spec.model, effort: spec.effort ?? null, sessionPolicy: spec.sessionPolicy,
      maxWorkers: spec.maxWorkers, permissionJson: spec.permission, secretsJson: spec.secrets,
      specRevision: role.specRevision + 1, updatedAt: nowIso(),
    });
    return get(role.id);
  };

  const service: RolesService = {
    list(projectId?: string): Role[] {
      return projectId
        ? ctx.db.all<Role>('SELECT * FROM roles WHERE workspace_id = ? AND project_id = ? ORDER BY created_at', [ctx.workspaceId, projectId])
        : ctx.db.all<Role>('SELECT * FROM roles WHERE workspace_id = ? ORDER BY created_at', [ctx.workspaceId]);
    },

    get,

    async hire(actor: Actor, rawSpec: RoleSpec, opts: { autoActivate?: boolean } = {}): Promise<{ role: Role; decisionId: string | null }> {
      const parsed = RoleSpecSchema.safeParse(rawSpec);
      if (!parsed.success) throw new OcError('validation', `invalid role spec: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const spec = parsed.data;
      const project = ctx.db.get<Project>('SELECT * FROM projects WHERE workspace_id = ? AND slug = ?', [ctx.workspaceId, spec.project]);
      if (!project) throw new OcError('not_found', `project ${spec.project} not found`);
      if (ctx.db.get<{ id: string }>('SELECT id FROM roles WHERE workspace_id = ? AND (id = ? OR slug = ?)', [ctx.workspaceId, spec.id, spec.id])) {
        throw new OcError('conflict', `role ${spec.id} already exists`);
      }
      if (!spec.runtime) spec.runtime = project.runtimeId;
      spec.createdAt = spec.createdAt ?? nowIso();

      const charter = renderCharter(ctx, spec);
      const now = nowIso();
      const autoActivate = opts.autoActivate === true || ctx.config.defaults.hireApproval === 'none';
      ctx.db.transaction(() => {
        ctx.db.insert('roles', {
          id: spec.id, workspaceId: ctx.workspaceId, projectId: project.id, slug: spec.id, name: spec.name,
          title: spec.title ?? null, icon: spec.icon ?? null, charterSummary: spec.charterSummary, scopeText: spec.scope,
          responsibilitiesJson: spec.responsibilities, capabilitiesJson: spec.capabilities, rulesJson: spec.rules,
          runtimeId: spec.runtime, model: spec.model ?? null, effort: spec.effort ?? null, permissionJson: spec.permission,
          sessionPolicy: spec.sessionPolicy, maxWorkers: spec.maxWorkers, secretsJson: spec.secrets,
          status: autoActivate ? 'active' : 'pending_activation', specRevision: 1, createdBy: spec.createdBy,
          createdAt: now, updatedAt: now,
        });
        writeRevision(spec.id, {}, spec, actor.kind === 'human' ? 'human' : 'conductor', 'hired', ['*']);
      });
      writeRoleFiles(ctx, spec, charter);

      let decisionId: string | null = null;
      if (!autoActivate) {
        const runtimeOptions = [...ctx.registries.runtimes.keys()].filter((r) => r !== spec.runtime).map((r) => ({ key: `runtime:${r}`, label: `Approve, but run on ${r}` }));
        try {
          const decision = deps().decisions.create(actor, {
            kind: 'hire_approval', owner: 'human', title: `Hire ${spec.name} for ${project.slug}?`,
            context: `${spec.charterSummary}\n\nScope: ${spec.scope}\n\nRuntime: ${spec.runtime}${spec.model ? ` (${spec.model})` : ''}, up to ${spec.maxWorkers} concurrent workers.`,
            options: [
              { key: 'approve', label: 'Approve and activate', recommended: true },
              ...runtimeOptions,
              { key: 'reject', label: 'Reject' },
            ],
            recommendation: 'approve',
            correlationKey: `hire:${spec.id}`,
            target: { roleId: spec.id },
            askedByAgentId: actor.kind === 'agent' ? actor.id : null,
          });
          decisionId = decision.id;
        } catch (e) {
          log.warn({ err: String(e), roleId: spec.id }, 'hire approval decision could not be created');
        }
      }

      const role = get(spec.id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.hire', 'role', role.id, { project: project.slug, autoActivate });
      ctx.events.emit('role.hired', 'role', role.id, { name: role.name, projectId: project.id, status: role.status, decisionId });
      log.info({ roleId: role.id, status: role.status }, 'role hired');
      return { role, decisionId };
    },

    async activate(actor: Actor, id: string, opts: { runtime?: string; model?: string | null } = {}): Promise<Role> {
      const role = get(id);
      const spec = rowToSpec(ctx, role);
      if (opts.runtime) spec.runtime = opts.runtime;
      if (opts.model !== undefined) spec.model = opts.model;
      ctx.db.update('roles', id, { status: 'active', runtimeId: spec.runtime, model: spec.model ?? null, pauseReason: null, updatedAt: nowIso() });
      writeRoleFiles(ctx, spec);
      const updated = get(id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.activate', 'role', id, { runtime: spec.runtime, model: spec.model });
      ctx.events.emit('role.activated', 'role', id, { runtime: spec.runtime, model: spec.model });
      return updated;
    },

    async update(actor: Actor, id: string, patch: Partial<RoleSpec>, reason: string, _opts: { applyToRunning?: boolean } = {}): Promise<Role> {
      const role = get(id);
      const before = rowToSpec(ctx, role);
      const merged = RoleSpecSchema.parse({ ...before, ...patch, id: before.id, project: before.project });
      const changedKeys = Object.keys(patch).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((merged as Record<string, unknown>)[k]));
      const updated = persistSpec(role, merged);
      writeRevision(id, before, merged, actor.kind === 'human' ? 'human' : actor.kind === 'agent' ? 'conductor' : 'system', reason, changedKeys);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.update', 'role', id, { changedKeys, reason });
      ctx.events.emit('role.updated', 'role', id, { changedKeys, reason });
      return updated;
    },

    async updateCharter(actor: Actor, id: string, charter: string, reason: string, opts: { applyToRunning?: boolean } = {}): Promise<Role> {
      const role = get(id);
      const dir = roleDir(ctx, id);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'CHARTER.md');
      const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
      writeFileSync(path, charter, 'utf8');
      ctx.db.update('roles', id, { specRevision: role.specRevision + 1, updatedAt: nowIso() });
      writeRevision(id, { charter: before }, { charter, applyToRunning: opts.applyToRunning === true }, actor.kind === 'human' ? 'human' : 'conductor', reason, ['charter']);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.charter', 'role', id, { reason, applyToRunning: opts.applyToRunning === true });
      ctx.events.emit('role.updated', 'role', id, { changedKeys: ['charter'], reason });
      return get(id);
    },

    charter(id: string): string {
      const role = get(id);
      const path = join(roleDir(ctx, id), 'CHARTER.md');
      if (existsSync(path)) return readFileSync(path, 'utf8');
      const rendered = renderCharter(ctx, rowToSpec(ctx, role));
      mkdirSync(roleDir(ctx, id), { recursive: true });
      writeFileSync(path, rendered, 'utf8');
      return rendered;
    },

    revisions(id: string) {
      return ctx.db.all<{ revision: number; author: string; reason: string | null; changedKeys: string[]; createdAt: string }>(
        'SELECT revision, author, reason, changed_keys_json, created_at FROM role_revisions WHERE role_id = ? ORDER BY revision',
        [id],
      );
    },

    async rollback(actor: Actor, id: string, revision: number): Promise<Role> {
      const role = get(id);
      const rev = ctx.db.get<{ after: unknown }>('SELECT after_json FROM role_revisions WHERE role_id = ? AND revision = ?', [id, revision]);
      if (!rev) throw new OcError('not_found', `role ${id} has no revision ${revision}`);
      const after = rev.after as Record<string, unknown>;
      if (after && typeof after === 'object' && typeof after.charter === 'string') {
        return service.updateCharter(actor, id, after.charter, `rollback to revision ${revision}`);
      }
      const spec = RoleSpecSchema.safeParse(after);
      if (!spec.success) throw new OcError('validation', `revision ${revision} of role ${id} is not a full spec`);
      const before = rowToSpec(ctx, role);
      const updated = persistSpec(role, spec.data, renderCharter(ctx, spec.data));
      writeRevision(id, before, spec.data, 'human', `rollback to revision ${revision}`, ['*']);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.rollback', 'role', id, { revision });
      ctx.events.emit('role.updated', 'role', id, { changedKeys: ['*'], reason: `rollback to ${revision}` });
      return updated;
    },

    pause(actor: Actor, id: string, reason: string): Role {
      get(id);
      ctx.db.update('roles', id, { status: 'paused', pauseReason: reason, updatedAt: nowIso() });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.pause', 'role', id, { reason });
      ctx.events.emit('role.paused', 'role', id, { reason });
      return get(id);
    },

    resume(actor: Actor, id: string): Role {
      get(id);
      ctx.db.update('roles', id, { status: 'active', pauseReason: null, updatedAt: nowIso() });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.resume', 'role', id, {});
      ctx.events.emit('role.resumed', 'role', id, {});
      return get(id);
    },

    async retire(actor: Actor, id: string, reason: string): Promise<{ role: Role; decisionId: string | null }> {
      const role = get(id);
      const live = liveWorkers(id);
      if (live > 0) {
        let decisionId: string | null = null;
        try {
          const decision = deps().decisions.create(actor, {
            kind: 'discard_approval', owner: 'human', title: `Retire ${role.name} with ${live} live worker(s)?`,
            context: `Retiring this role stops new workers. ${live} worker(s) are still live; their tickets need a decision first.\n\nReason: ${reason}`,
            options: [{ key: 'approve', label: 'Retire the role and cancel its workers' }, { key: 'reject', label: 'Keep the role', recommended: true }],
            correlationKey: `retire:${id}`, target: { roleId: id },
          });
          decisionId = decision.id;
        } catch (e) { log.warn({ err: String(e), roleId: id }, 'retire decision could not be created'); }
        return { role, decisionId };
      }
      ctx.db.update('roles', id, { status: 'retired', pauseReason: reason, updatedAt: nowIso() });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.retire', 'role', id, { reason });
      ctx.events.emit('role.retired', 'role', id, { reason });
      return { role: get(id), decisionId: null };
    },

    freeSlots(id: string): number {
      const role = get(id);
      return Math.max(0, role.maxWorkers - liveWorkers(id));
    },
  };
  return service;
}
