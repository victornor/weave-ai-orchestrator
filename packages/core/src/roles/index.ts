import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { newId, nowIso } from '@weave-ai/db';
import { OcError, RoleSpecSchema, NAMED_CARD_OPTION_KEYS, toLegacyRoleSpec, projectLabel, type Agent, type Role, type RoleSpec, type Project } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, RoleConcurrency, RoleUpdateRequestResult, RoleUpdateResult, RolesService } from '../api.js';
import { recordActivity } from '../events.js';
import { renderCharter } from '../prompts/index.js';
import { renderHome } from '../workers/home.js';

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
  // VS-263 Decision 6: role.yaml is a persisted artifact a rolled-back pre-VS-263 daemon must still
  // be able to parse, so `createdBy` keeps its legacy spelling on disk for now — do not remove this
  // without checking whether rollback-to-pre-VS-263 is still an operational concern (see design.md).
  writeFileSync(join(dir, 'role.yaml'), YAML.stringify(toLegacyRoleSpec(spec), { lineWidth: 0 }), 'utf8');
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
    sessionPolicy: role.sessionPolicy, maxWorkers: role.maxWorkers, memoryLimitMb: role.memoryLimitMb,
    permission: role.permission, secrets: role.secrets, createdBy: role.createdBy,
  });
}

/**
 * The spec template's rendering of `spec`, or null when it cannot be produced. `update` compares a
 * role's on-disk `CHARTER.md` against this to tell a daemon-generated charter from one a human or the
 * weaver wrote by hand (VS-335): only the former is rewritten when the spec changes.
 */
function specRenderedCharter(ctx: WorkspaceContext, spec: RoleSpec): string | null {
  try { return renderCharter(ctx, spec); } catch { return null; }
}


export function createRolesService(ctx: WorkspaceContext, deps: () => CoreServices): RolesService {
  const log = ctx.log('daemon');

  const get = (id: string): Role => {
    const r = ctx.db.get<Role>('SELECT * FROM roles WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
    if (!r) throw new OcError('not_found', `role ${id} not found`);
    return r;
  };

  /**
   * VS-335: re-render each live worker's brief after a spec change, so a worker does not keep a
   * turn's worth of stale instructions. `ensureHomeCurrent` remains the backstop for workers this
   * did not reach. Returns how many were re-briefed.
   */
  const rebriefLiveWorkers = async (roleId: string): Promise<number> => {
    const workers = ctx.db.all<Agent>(`SELECT * FROM agents WHERE role_id = ? AND status IN ${LIVE_WORKER_STATUSES}`, [roleId]);
    let reBriefed = 0;
    for (const w of workers) {
      try { await renderHome(ctx, deps, w); reBriefed += 1; }
      catch (e) { log.warn({ err: String(e), agentId: w.id, roleId }, 're-brief after a role update failed'); }
    }
    return reBriefed;
  };

  const liveWorkers = (roleId: string): number =>
    ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM agents WHERE role_id = ? AND status IN ${LIVE_WORKER_STATUSES}`, [roleId])?.n ?? 0;

  const liveInProject = (projectId: string): number =>
    ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM agents WHERE project_id = ? AND kind = 'worker' AND status IN ${LIVE_WORKER_STATUSES}`, [projectId])?.n ?? 0;

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
      sessionPolicy: spec.sessionPolicy,
      maxWorkers: spec.maxWorkers, memoryLimitMb: spec.memoryLimitMb, permissionJson: spec.permission, secretsJson: spec.secrets,
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
      spec.createdAt = spec.createdAt ?? nowIso();

      const charter = renderCharter(ctx, spec);
      const now = nowIso();
      const autoActivate = opts.autoActivate === true || ctx.config.defaults.hireApproval === 'none';
      ctx.db.transaction(() => {
        ctx.db.insert('roles', {
          id: spec.id, workspaceId: ctx.workspaceId, projectId: project.id, slug: spec.id, name: spec.name,
          title: spec.title ?? null, icon: spec.icon ?? null, charterSummary: spec.charterSummary, scopeText: spec.scope,
          responsibilitiesJson: spec.responsibilities, capabilitiesJson: spec.capabilities, rulesJson: spec.rules,
          permissionJson: spec.permission,
          sessionPolicy: spec.sessionPolicy, maxWorkers: spec.maxWorkers, memoryLimitMb: spec.memoryLimitMb, secretsJson: spec.secrets,
          status: autoActivate ? 'active' : 'pending_activation', specRevision: 1, createdBy: spec.createdBy,
          createdAt: now, updatedAt: now,
        });
        writeRevision(spec.id, {}, spec, actor.kind === 'human' ? 'human' : 'weaver', 'hired', ['*']);
      });
      writeRoleFiles(ctx, spec, charter);

      let decisionId: string | null = null;
      if (!autoActivate) {
        try {
          // Approve or decline, and nothing about a runtime (VS-77): a role does not carry one, and
          // every worker it spawns runs on the workspace's workers setting.
          const decision = deps().decisions.create(actor, {
            kind: 'hire_approval', owner: 'human', title: `Hire ${spec.name} for ${projectLabel(project)}?`,
            context: `${spec.charterSummary}\n\nScope: ${spec.scope}\n\nUp to ${spec.maxWorkers} concurrent workers, on the workspace's workers model setting.`,
            options: [
              { key: NAMED_CARD_OPTION_KEYS.hire_approval.approve, label: 'Approve and activate', recommended: true },
              { key: NAMED_CARD_OPTION_KEYS.hire_approval.reject, label: 'Reject' },
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

    async activate(actor: Actor, id: string): Promise<Role> {
      const role = get(id);
      const spec = rowToSpec(ctx, role);
      ctx.db.update('roles', id, { status: 'active', pauseReason: null, updatedAt: nowIso() });
      writeRoleFiles(ctx, spec);
      const updated = get(id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.activate', 'role', id, {});
      ctx.events.emit('role.activated', 'role', id, {});
      return updated;
    },

    async update(actor: Actor, id: string, patch: Partial<RoleSpec>, reason: string, opts: { applyToRunning?: boolean } = {}): Promise<RoleUpdateResult> {
      const role = get(id);
      const before = rowToSpec(ctx, role);
      // Strict on the patch, not on the merge: an unknown key would otherwise be stripped and the
      // update would report success having changed nothing — the same silent no-op the route guards
      // against (VS-32), and now the way a caller learns a role no longer carries a runtime (VS-77).
      const checked = RoleSpecSchema.partial().strict().safeParse(patch);
      if (!checked.success) {
        throw new OcError('validation', `invalid role patch: ${checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      const merged = RoleSpecSchema.parse({ ...before, ...patch, id: before.id, project: before.project });
      const changedKeys = Object.keys(patch).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((merged as Record<string, unknown>)[k]));
      // VS-335: a charter the daemon rendered from the spec is refreshed with it; a hand-written one
      // is left alone and reported, so a spec edit never silently overwrites someone's prose.
      const charterPath = join(roleDir(ctx, id), 'CHARTER.md');
      const currentCharter = existsSync(charterPath) ? readFileSync(charterPath, 'utf8') : null;
      const renderedBefore = specRenderedCharter(ctx, before);
      const charterRewritten = currentCharter !== null && renderedBefore !== null && currentCharter === renderedBefore;
      const updated = persistSpec(role, merged, charterRewritten ? renderCharter(ctx, merged) : undefined);
      writeRevision(id, before, merged, actor.kind === 'human' ? 'human' : actor.kind === 'agent' ? 'weaver' : 'system', reason, changedKeys);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'role.update', 'role', id, { changedKeys, reason });
      ctx.events.emit('role.updated', 'role', id, { changedKeys, reason });
      const reBriefed = opts.applyToRunning === true ? await rebriefLiveWorkers(id) : 0;
      return { role: updated, changedKeys, charterRewritten, reBriefed };
    },

    /**
     * The tool/route-facing write (VS-335). Immutable and separately-owned fields are refused here
     * rather than routed, so `secrets` and `maxWorkers` keep their own validation; a patch that
     * changes `permission` is held whole for the approval the hire policy asks for, so approval can
     * never leave a half-applied edit.
     */
    async requestUpdate(actor: Actor, id: string, patch: Partial<RoleSpec>, reason: string, opts: { applyToRunning?: boolean } = {}): Promise<RoleUpdateRequestResult> {
      const keys = Object.keys(patch ?? {});
      if (keys.length === 0) throw new OcError('validation', 'role update patch is empty; nothing to change');
      if ('id' in patch || 'project' in patch) {
        throw new OcError('validation', 'a role\'s id and project are immutable and cannot be patched');
      }
      if ('secrets' in patch) throw new OcError('validation', 'a role\'s secrets are changed with weave_role_set_secrets, which validates the names against the store');
      if ('maxWorkers' in patch) throw new OcError('validation', 'a role\'s maxWorkers is changed with weave_role_set_max_workers');
      const checked = RoleSpecSchema.partial().strict().safeParse(patch);
      if (!checked.success) {
        throw new OcError('validation', `invalid role patch: ${checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      const role = get(id);
      const before = rowToSpec(ctx, role);
      const nextPermission = checked.data.permission;
      const permissionChanged = nextPermission !== undefined && JSON.stringify(nextPermission) !== JSON.stringify(before.permission);
      if (permissionChanged && ctx.config.defaults.hireApproval !== 'none') {
        const decision = deps().decisions.create(actor, {
          kind: 'hire_approval',
          // The card is an approval of an existing role, not a hire; `target.permissionChange` tells
          // the UI and `applyHireApproval` which of the two this is.
          title: `Change permission for ${role.name}?`,
          context: `A role's permission is security-sensitive, so this change follows the hire policy.\n\nMode: ${before.permission.mode} → ${nextPermission.mode}\nAllowed: ${nextPermission.allowed.join(', ') || '(none)'}\nDenied: ${nextPermission.denied.join(', ') || '(none)'}\n\nReason: ${reason}`,
          options: [
            { key: NAMED_CARD_OPTION_KEYS.hire_approval.approve, label: 'Approve' },
            { key: NAMED_CARD_OPTION_KEYS.hire_approval.reject, label: 'Reject' },
          ],
          correlationKey: `role-permission:${id}`,
          target: { roleId: id, permissionChange: true, patch, reason, applyToRunning: opts.applyToRunning === true },
          askedByAgentId: actor.kind === 'agent' ? actor.id : null,
        });
        recordActivity(ctx.db, ctx.workspaceId, actor, 'role.update_pending', 'role', id, { decisionId: decision.id, changedKeys: keys });
        return { role, changedKeys: keys, charterRewritten: false, reBriefed: 0, decisionId: decision.id, applied: false };
      }
      const result = await service.update(actor, id, patch, reason, opts);
      return { ...result, decisionId: null, applied: true };
    },

    /**
     * The role's secrets, by name (VS-92). Structured rather than prose, which is why this is not
     * `updateCharter`: the names have to be checked against the store, and the whole list is refused
     * if one is missing. A role listing a secret nobody registered produces a worker whose
     * environment silently lacks the variable, which fails much later and reads as a bug elsewhere.
     */
    async setSecrets(actor: Actor, id: string, names: string[], reason: string): Promise<Role> {
      const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      const missing = wanted.filter((n) => !deps().secrets.has(n));
      if (missing.length) {
        throw new OcError('not_found', `no secret registered under ${missing.map((n) => `"${n}"`).join(', ')}`, { missing, known: deps().secrets.list().map((s) => s.name) });
      }
      return (await service.update(actor, id, { secrets: wanted }, reason)).role;
    },

    async updateCharter(actor: Actor, id: string, charter: string, reason: string, opts: { applyToRunning?: boolean } = {}): Promise<Role> {
      const role = get(id);
      const dir = roleDir(ctx, id);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'CHARTER.md');
      const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
      writeFileSync(path, charter, 'utf8');
      ctx.db.update('roles', id, { specRevision: role.specRevision + 1, updatedAt: nowIso() });
      writeRevision(id, { charter: before }, { charter, applyToRunning: opts.applyToRunning === true }, actor.kind === 'human' ? 'human' : 'weaver', reason, ['charter']);
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
            options: [
              { key: NAMED_CARD_OPTION_KEYS.discard_approval.approve, label: 'Retire the role and cancel its workers' },
              { key: NAMED_CARD_OPTION_KEYS.discard_approval.reject, label: 'Keep the role', recommended: true },
            ],
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
      return service.concurrency(id).free;
    },

    concurrency(id: string): RoleConcurrency {
      const role = get(id);
      const projectMax = ctx.db.get<{ maxWorkers: number }>('SELECT max_workers FROM projects WHERE id = ?', [role.projectId])?.maxWorkers ?? role.maxWorkers;
      const live = liveWorkers(id);
      const projectLive = liveInProject(role.projectId);
      // roleMax is the stored field (hire / weave_role_set_max_workers); it is not a spawn gate.
      // Spawn and freeSlots honour only the project cap (VS-156).
      return {
        roleMax: role.maxWorkers, projectMax, effective: projectMax, live, projectLive,
        free: Math.max(0, projectMax - projectLive),
      };
    },
  };
  return service;
}
