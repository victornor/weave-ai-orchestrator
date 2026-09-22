import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import {
  HANDOVER_PAUSE_CODE, OcError, TERMINAL_TICKET_STATUSES, heldByHuman, landingBranchOf, projectLabel, waitingOnRuntimeLogin,
  type Agent, type ChannelThread, type Plan, type Project, type Role, type Ticket, type TicketStatus,
} from '@weave-ai/shared';
import type { WorktreeProvider } from '@weave-ai/plugin-sdk';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, HandoverEndResult, HandoverStartResult, TicketCreateInput, WorkerMessageOutcome, WorkersService } from '../api.js';
import { recordActivity } from '../events.js';
import { recordHumanInputEvent, runState } from '../runs/active.js';
import { renderHome } from './home.js';
import { renderBrief, withDictatedNotice } from '../prompts/index.js';
import { createSessions } from '../sessions/index.js';
import { effectiveModels, modelSettingFor, modelsFor, resolveWorkerModelId as resolveWorkerModelOption } from '../models/resolve.js';
import { landedWorkTest, worktreeChanges } from '../worktrees/landed.js';
import { configureGitWorktreeIdentity, git, requireGitIdentity, worktreeState } from '../util/git.js';
import { buildHandoverCommand } from './resume-command.js';
import { sessionActivitySignal } from './activity-signal.js';
import { handoverCommentBody, reconcileHandover, type HandoverSnapshot } from './handover-reconcile.js';

export { renderHome, ensureHomeCurrent, skillsFor } from './home.js';

const LIVE = "('provisioning','active','running','paused','error')";

/** VS-477: a planner whose tab has been unfocused and which has taken no turn for this long is retired by an idle sweep, bounding how many planner worktrees several tabs can hold. */
export const PLANNER_IDLE_RETIRE_MS = 15 * 60_000;

/**
 * VS-333: a terminal ticket's stale pull-request record is refreshed from the forge before a
 * retirement is refused, but `retireFinished` runs on every supervisor tick (15 s), so a genuinely
 * open PR would cost about 240 `gh pr view` calls an hour, forever. One refresh per worker per
 * window is plenty.
 */
const PR_REFRESH_WINDOW_MS = 60 * 60_000;

/** How many archived paths a rescue comment or activity payload names before summarising the rest. */
const ARCHIVE_LIST_CAP = 50;

function cappedFileList(files: string[]): { files: string[]; more: number } {
  return { files: files.slice(0, ARCHIVE_LIST_CAP), more: Math.max(0, files.length - ARCHIVE_LIST_CAP) };
}

function archivedComment(archivePath: string, workerId: string, files: string[]): string {
  const { files: shown, more } = cappedFileList(files);
  return [
    `The worker was retired and its untracked leftovers were kept at \`${join(archivePath, workerId, 'untracked')}\`:`,
    ...shown.map((f) => `- \`${f}\``),
    ...(more ? [`and ${more} more.`] : []),
    'The archive is pruned after the configured retention window, so recover anything you need before then.',
  ].join('\n');
}


/**
 * VS-375: whether this worker already has the resume a relaunch would create. A shut-down cut leaves
 * the run's own wakes `queued` (`engine.finalize`'s preserve branch) with the run recorded
 * `interrupted_by_shutdown`, so the dispatcher will claim them. Read from the records rather than a
 * flag, so an ordinary queued wake — a queued message, a retry — is not mistaken for a preserved one.
 */
function preservedResumeQueued(ctx: WorkspaceContext, workerId: string): boolean {
  const queuedIds = new Set(
    ctx.db.all<{ id: string }>("SELECT id FROM wakeups WHERE agent_id = ? AND status = 'queued'", [workerId]).map((w) => w.id),
  );
  if (queuedIds.size === 0) return false;
  const runs = ctx.db.all<{ wakeupIds: string[] | null }>(
    "SELECT wakeup_ids_json FROM runs WHERE agent_id = ? AND status = 'interrupted' AND error_code = 'interrupted_by_shutdown'",
    [workerId],
  );
  return runs.some((r) => (r.wakeupIds ?? []).some((id) => queuedIds.has(id)));
}

/**
 * VS-625: who put a worker back to work, in the words a card's close note uses. A resume/relaunch
 * reaches here from the human, from the conductor's `weave_worker_relaunch`, or from the daemon's
 * own recovery.
 */
function resumerLabel(actor: Actor): string {
  return actor.kind === 'human' ? 'the human' : actor.kind === 'agent' ? 'the weaver' : 'the system';
}

export function branchSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'work';
}

/** `ac/<identifier-lowercase>-<slug>` (PLAN §11.2); the OpenSpec change name is the same without the prefix. */
export function ticketBranch(ticket: Ticket): string { return `ac/${ticket.identifier.toLowerCase()}-${branchSlug(ticket.title)}`; }
export function openspecChangeName(ticket: Ticket): string { return `${ticket.identifier.toLowerCase()}-${branchSlug(ticket.title)}`; }
/** VS-398: a planner's disposable worktree never commits or opens a pull request, so its branch name only needs to be valid and unique — never pushed, never read back. */
export function planBranch(plan: Plan): string { return `plan/${plan.id.toLowerCase()}`; }

/**
 * VS-636: does this agent owe a checkout? A worker — or a persistent session that has taken a ticket —
 * whose `branch` is set. `spawn`/`takeTicketForSession` set the branch before provisioning, so a row
 * whose provisioning a restart cut off still answers yes. A no-worktree knowledge-curation worker and
 * a ticketless session have `branch` null and are left alone.
 */
export function agentNeedsCheckout(agent: { kind: string; projectId: string | null; branch: string | null }): boolean {
  return (agent.kind === 'worker' || agent.kind === 'session') && agent.projectId !== null && agent.branch !== null;
}

export function createWorkersService(ctx: WorkspaceContext, deps: () => CoreServices): WorkersService {
  const log = ctx.log('daemon');
  const sessions = createSessions(ctx);
  /** Worker id → epoch ms of the last forge PR refresh (VS-333); lost on daemon restart, which just re-reads once. */
  const prRefreshedAt = new Map<string, number>();

  const get = (id: string): Agent => {
    const a = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
    if (!a) throw new OcError('not_found', `agent ${id} not found`);
    return a;
  };
  const ticketOf = (id: string): Ticket => {
    const t = ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId])
      ?? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE identifier = ? AND workspace_id = ?', [id, ctx.workspaceId]);
    if (!t) throw new OcError('not_found', `ticket ${id} not found`);
    return t;
  };
  const projectOf = (id: string): Project => {
    const p = ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [id]);
    if (!p) throw new OcError('not_found', `project ${id} not found`);
    return p;
  };
  const providerFor = (project: Project): WorktreeProvider => {
    const p = ctx.registries.worktreeProviders.get(project.worktreeProvider) ?? ctx.registries.worktreeProviders.get('git');
    if (!p) throw new OcError('internal', 'no worktree provider registered');
    return p;
  };
  const liveInProject = (projectId: string): number =>
    ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM agents WHERE project_id = ? AND kind = 'worker' AND status IN ${LIVE}`, [projectId])?.n ?? 0;

  /**
   * VS-495: the worktree a ticket's own agent works in — factored out of `spawn()` so
   * `takeTicketForSession` can give a session's agent the same worktree a spawned worker would get,
   * without going through `spawn()` itself (which creates a second, `kind='worker'` agent).
   */
  async function provisionTicketWorktree(agentId: string, home: string, project: Project, ticket: Ticket, branch: string): Promise<{ path: string; branch: string; worktreeRowId: string }> {
    const identity = await requireGitIdentity(project.clonePath);
    const provider = providerFor(project);
    const targetPath = join(home, 'work');
    const info = await provider.create({
      repoPath: project.clonePath, branch, base: landingBranchOf(project, ticket), targetPath,
      setupCommand: project.setupCommand ?? undefined, warmPaths: (project as unknown as { warmPaths?: string[] }).warmPaths ?? [],
      configPath: ctx.paths.wtConfig,
    });
    await configureGitWorktreeIdentity(project.clonePath, info.path, identity);
    const worktreeRowId = newId();
    const now = nowIso();
    const resolvedBranch = info.branch || branch;
    ctx.db.insert('worktrees', {
      id: worktreeRowId, projectId: project.id, ticketId: ticket.id, agentId, provider: provider.id,
      path: info.path, branch: resolvedBranch, status: 'active', createdAt: now, lastVerifiedAt: now,
    });
    ctx.db.update('agents', agentId, { worktreePath: info.path, branch: resolvedBranch, updatedAt: nowIso() });
    return { path: info.path, branch: resolvedBranch, worktreeRowId };
  }

  /**
   * VS-526: a ticketless persistent session has no ticket, so no worktree, and its home is where the
   * turn runs — but several runtimes (codex 0.154.0 among them) refuse to start in a directory that
   * is not a Git repository. Initialise the home as a repository with a single empty commit so such
   * a runtime can start; the session's rendered `AGENTS.md` is excluded so its own instructions are
   * not mistaken for the project's. Idempotent: an existing repository is left untouched.
   */
  async function ensureSessionRepo(home: string): Promise<void> {
    mkdirSync(home, { recursive: true });
    if (existsSync(join(home, '.git'))) return;
    const init = await git(['init'], home, 30_000);
    if (!init.ok) throw new OcError('internal', `could not initialise the session directory as a Git repository: ${init.stderr.trim() || init.stdout.trim()}`);
    writeFileSync(join(home, '.gitignore'), 'AGENTS.md\n.ac-render.json\n');
    const add = await git(['add', '.gitignore'], home, 30_000);
    if (!add.ok) throw new OcError('internal', `could not stage the session directory's initial commit: ${add.stderr.trim()}`);
    const commit = await git(
      ['-c', 'user.name=Weave AI', '-c', 'user.email=weave@localhost', 'commit', '--allow-empty', '-m', 'session workspace'],
      home, 30_000,
    );
    if (!commit.ok) throw new OcError('internal', `could not create the session directory's initial commit: ${commit.stderr.trim()}`);
  }

  /** Rolls back a `provisionTicketWorktree` call (or a plain checkout on the same branch) that must not survive — same shape `spawn()`'s and `takeTicketForSession`'s failure handlers both need. */
  async function removeTicketWorktree(home: string, project: Project, branch: string, worktreeRowId: string | null): Promise<void> {
    try {
      const provider = providerFor(project);
      await provider.remove({ repoPath: project.clonePath, path: join(home, 'work'), branch, deleteBranch: true, force: true, configPath: ctx.paths.wtConfig }).catch(() => undefined);
    } catch { /* best effort */ }
    if (worktreeRowId) ctx.db.run('DELETE FROM worktrees WHERE id = ?', [worktreeRowId]);
  }

  /** VS-636: in-flight `ensureWorktree` calls, keyed by agent, so a repair racing a spawn creates one worktree, not two. */
  const worktreeEnsures = new Map<string, Promise<{ path: string; branch: string; provisioned: boolean }>>();

  /**
   * VS-636: see `WorkersService.ensureWorktree`. A worker whose provisioning a daemon restart cut off
   * keeps a null `worktreePath`; the run engine, `relaunch` and the supervisor's boot sweep all call
   * this so such a worker is repaired rather than run checkoutless. Serialised per agent and
   * idempotent, and it never resets, cleans or switches an existing worktree.
   */
  async function ensureWorktree(agentId: string): Promise<{ path: string; branch: string; provisioned: boolean }> {
    const pending = worktreeEnsures.get(agentId);
    if (pending) return pending;
    const attempt = (async () => {
      const agent = get(agentId);
      if (!agentNeedsCheckout(agent)) return { path: agent.worktreePath ?? agent.homePath, branch: agent.branch ?? '', provisioned: false };
      if (agent.worktreePath && existsSync(agent.worktreePath)) return { path: agent.worktreePath, branch: agent.branch ?? '', provisioned: false };

      const project = projectOf(agent.projectId!);
      const ticket = agent.ticketId ? ticketOf(agent.ticketId) : null;
      const branch = agent.branch ?? (ticket ? ticketBranch(ticket) : null);
      if (!branch) throw new OcError('internal', `${agent.name} needs a worktree but has no branch to create it on`);

      const targetPath = join(agent.homePath, 'work');
      const identity = await requireGitIdentity(project.clonePath);
      const provider = providerFor(project);
      const info = await provider.create({
        repoPath: project.clonePath, branch, base: landingBranchOf(project, ticket), targetPath,
        setupCommand: project.setupCommand ?? undefined, warmPaths: (project as unknown as { warmPaths?: string[] }).warmPaths ?? [],
        configPath: ctx.paths.wtConfig,
      });
      await configureGitWorktreeIdentity(project.clonePath, info.path, identity);
      const resolvedBranch = info.branch || branch;
      const now = nowIso();
      const existing = ctx.db.get<{ id: string }>('SELECT id FROM worktrees WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1', [agentId]);
      if (existing) ctx.db.update('worktrees', existing.id, { path: info.path, branch: resolvedBranch, status: 'active', provider: provider.id, lastVerifiedAt: now });
      else {
        ctx.db.insert('worktrees', {
          id: newId(), projectId: project.id, ticketId: ticket?.id ?? null, agentId, provider: provider.id,
          path: info.path, branch: resolvedBranch, status: 'active', createdAt: now, lastVerifiedAt: now,
        });
      }
      ctx.db.update('agents', agentId, { worktreePath: info.path, branch: resolvedBranch, updatedAt: now });
      recordActivity(
        ctx.db, ctx.workspaceId, { kind: 'system', id: null }, 'worker.worktree_provisioned', 'agent', agentId,
        { path: info.path, branch: resolvedBranch, ticketId: ticket?.id ?? null }, ticket?.id ?? agent.ticketId,
      );
      log.warn({ agentId, ticketId: ticket?.id ?? null, path: info.path }, 'provisioned a missing worktree outside spawn');
      return { path: info.path, branch: resolvedBranch, provisioned: true };
    })();
    worktreeEnsures.set(agentId, attempt);
    try { return await attempt; } finally { worktreeEnsures.delete(agentId); }
  }

  async function spawn(actor: Actor, ticketId: string, opts: { noWorktree?: boolean; spawnReason?: string } = {}): Promise<Agent> {
    const ticket = ticketOf(ticketId);
    // VS-495: a persistent session already holding this ticket counts as "already spawned" too — the
    // caller (retry, the merge queue, the escalation sweep) wants *an* agent to hand the ticket back
    // to, and creating a second, kind='worker' agent on a session's own ticket would be a duplicate,
    // not a recovery.
    const existing = ctx.db.get<Agent>(`SELECT * FROM agents WHERE ticket_id = ? AND kind IN ('worker','session') AND status IN ${LIVE}`, [ticket.id]);
    if (existing) return existing;
    if (!ticket.assigneeRoleId) throw new OcError('validation', `ticket ${ticket.identifier} is not assigned to a role`);
    const role = ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [ticket.assigneeRoleId]);
    if (!role) throw new OcError('not_found', `role ${ticket.assigneeRoleId} not found`);
    if (role.status !== 'active') throw new OcError('wrong_status', `role ${role.id} is ${role.status}`);
    const project = projectOf(role.projectId);

    if (liveInProject(project.id) >= project.maxWorkers) throw new OcError('role_full', `project ${project.slug} is at its worker limit (${project.maxWorkers})`, { projectId: project.id });

    const id = newId();
    const home = join(ctx.paths.workers, id);
    const n = (ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM agents WHERE role_id = ?', [role.id])?.n ?? 0) + 1;
    const now = nowIso();
    const branch = ticketBranch(ticket);
    const spawnedBy = actor.kind === 'human' ? 'human' : actor.kind === 'agent' ? 'weaver' : 'system';

    ctx.db.insert('agents', {
      id, workspaceId: ctx.workspaceId, kind: 'worker', projectId: project.id, roleId: role.id, roleRevision: role.specRevision,
      ticketId: ticket.id, name: `${role.name} #${n}`, runtimeId: modelSettingFor(modelsFor(ctx), 'worker', ticket).runtime,
      status: 'provisioning', homePath: home, worktreePath: null, branch: opts.noWorktree ? null : branch,
      turnEpoch: 0, turnCount: 0, spawnedBy, spawnReason: opts.spawnReason ?? `ticket ${ticket.identifier}`,
      briefRevision: 1, createdAt: now, updatedAt: now,
    });

    let worktreeRowId: string | null = null;
    try {
      mkdirSync(home, { recursive: true });
      if (!opts.noWorktree) {
        ({ worktreeRowId } = await provisionTicketWorktree(id, home, project, ticket, branch));
      }

      // Bind the ticket to this worker (TicketsService has no setter for worker_id).
      ctx.db.run('UPDATE tickets SET worker_id = ?, updated_at = ? WHERE id = ?', [id, nowIso(), ticket.id]);
      if (ticket.kind === 'change' && project.openspecEnabled && !ticket.openspecChangeName) {
        ctx.db.run('UPDATE tickets SET openspec_change_name = ? WHERE id = ?', [openspecChangeName(ticket), ticket.id]);
      }
      if (ticket.status === 'backlog') {
        try { await deps().tickets.transition({ kind: 'system', id: null }, ticket.id, { to: 'todo', note: 'worker spawned' }); }
        catch { ctx.db.run("UPDATE tickets SET status = 'todo', updated_at = ? WHERE id = ?", [nowIso(), ticket.id]); }
      }

      const agent = get(id);
      await renderHome(ctx, deps, agent);
      ctx.db.update('agents', id, { status: 'active', updatedAt: nowIso() });
      sessions.forTurn({ id, kind: 'worker', runtimeId: modelSettingFor(modelsFor(ctx), 'worker', ticket).runtime }, role.sessionPolicy, ctx.toolContractHash?.('worker'));
      deps().wake.enqueue(id, { source: 'ticket_assigned', reason: `${ticket.identifier}: ${ticket.title}`, payload: { ticketId: ticket.id }, requestedBy: actor });
    } catch (e) {
      // Roll back the row, the home and the worktree; nothing half-created is left behind.
      log.error({ err: String(e), ticketId: ticket.id }, 'worker spawn failed; rolling back');
      if (!opts.noWorktree) await removeTicketWorktree(home, project, branch, worktreeRowId);
      ctx.db.run('DELETE FROM wakeups WHERE agent_id = ?', [id]);
      ctx.db.run('DELETE FROM agent_sessions WHERE agent_id = ?', [id]);
      ctx.db.run('UPDATE tickets SET worker_id = NULL WHERE worker_id = ?', [id]);
      ctx.db.run('DELETE FROM agents WHERE id = ?', [id]);
      try { rmSync(home, { recursive: true, force: true }); } catch { /* leave the directory for inspection */ }
      throw e instanceof OcError ? e : new OcError('internal', `worker spawn failed: ${String(e)}`);
    }

    const agent = get(id);
    recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.spawn', 'agent', id, { ticketId: ticket.id, roleId: role.id, branch }, ticket.id);
    ctx.events.emit('worker.spawned', 'agent', id, { name: agent.name, ticketId: ticket.id, roleId: role.id, projectId: project.id, branch: agent.branch });
    log.info({ workerId: id, ticket: ticket.identifier, role: role.id }, 'worker spawned');
    return agent;
  }

  /** Progress note the relaunched worker gets in its brief (PLAN §11.6). */
  async function progressNote(agent: Agent, ticket: Ticket | null): Promise<string> {
    const bits: string[] = [];
    if (ticket) {
      bits.push(`Ticket ${ticket.identifier} is ${ticket.status}.`);
      const last = ctx.db.get<{ body: string; createdAt: string }>("SELECT body, created_at FROM ticket_comments WHERE ticket_id = ? AND kind = 'status' ORDER BY created_at DESC LIMIT 1", [ticket.id]);
      if (last) bits.push(`Last status (${last.createdAt}): ${last.body.slice(0, 200)}`);
      const state = (ticket.openspecState ?? null) as { tasks?: { total?: number; complete?: number } } | null;
      if (state?.tasks && typeof state.tasks.total === 'number') bits.push(`Tasks ticked: ${state.tasks.complete ?? 0}/${state.tasks.total}.`);
    }
    if (agent.worktreePath && existsSync(agent.worktreePath)) {
      const project = agent.projectId ? ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [agent.projectId]) : null;
      const st = await worktreeState(agent.worktreePath, project?.defaultBranch ?? 'main');
      bits.push(`Worktree: ${st.dirty ? `${st.changedFiles} uncommitted change(s)` : 'clean'}, ${st.ahead} ahead / ${st.behind} behind ${project?.defaultBranch ?? 'main'}.`);
      const lastCommit = await git(['log', '-1', '--pretty=%h %s'], agent.worktreePath, 20_000);
      if (lastCommit.ok && lastCommit.stdout.trim()) bits.push(`Last commit: ${lastCommit.stdout.trim().slice(0, 200)}`);
    }
    return bits.join(' ');
  }

  /** Is this runtime stopped for an expired login? Read directly: the accounts service may be absent in a harness. */
  const gatedRuntime = (runtimeId: string): boolean =>
    Boolean(ctx.db.get<{ runtimeId: string }>('SELECT runtime_id FROM runtime_credentials WHERE workspace_id = ? AND runtime_id = ? AND needs_login = 1', [ctx.workspaceId, runtimeId]));

  const service: WorkersService = {
    list(filter = {}): Agent[] {
      // VS-525: `kinds` lets a caller read another agent kind (a role's `session` agents, to show
      // whether its chat already exists) without changing what the default callers — the presenter,
      // the roles detail route, the worker tool — get back: transient workers only.
      const kinds = filter.kinds?.length ? filter.kinds : ['worker'];
      const where = ['workspace_id = ?', `kind IN (${kinds.map(() => '?').join(',')})`];
      const params: unknown[] = [ctx.workspaceId, ...kinds];
      if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status); }
      else if (!filter.includeRetired) where.push("status != 'retired'");
      if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
      if (filter.roleId) { where.push('role_id = ?'); params.push(filter.roleId); }
      return ctx.db.all<Agent>(`SELECT * FROM agents WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params as never[]);
    },

    get,

    conductor(): Agent {
      const a = ctx.db.get<Agent>("SELECT * FROM agents WHERE workspace_id = ? AND kind = 'weaver'", [ctx.workspaceId]);
      if (!a) throw new OcError('not_found', 'no weaver for this workspace');
      return a;
    },

    async ensureConductor(): Promise<Agent> {
      let a = ctx.db.get<Agent>("SELECT * FROM agents WHERE workspace_id = ? AND kind = 'weaver'", [ctx.workspaceId]);
      const setting = modelSettingFor(modelsFor(ctx), 'weaver');
      if (!a) {
        const id = newId();
        const now = nowIso();
        mkdirSync(ctx.paths.weaver, { recursive: true });
        ctx.db.insert('agents', {
          id, workspaceId: ctx.workspaceId, kind: 'weaver', projectId: null, roleId: null, roleRevision: null, ticketId: null,
          name: 'Weaver', runtimeId: setting.runtime,
          status: 'active', homePath: ctx.paths.weaver, turnEpoch: 0, turnCount: 0, spawnedBy: 'system', spawnReason: 'workspace bootstrap',
          briefRevision: 1, createdAt: now, updatedAt: now,
        });
        a = get(id);
        ctx.events.emit('worker.spawned', 'agent', id, { name: 'Weaver', kind: 'weaver' });
      } else if (a.runtimeId !== setting.runtime) {
        // The row records what the conductor is on; the setting decides. `forTurn` below retires a
        // session that belonged to the runtime we are moving away from (VS-77).
        ctx.db.update('agents', a.id, { runtimeId: setting.runtime, updatedAt: nowIso() });
        a = get(a.id);
      }
      await renderHome(ctx, deps, a);
      sessions.forTurn({ id: a.id, kind: 'weaver', runtimeId: a.runtimeId }, 'persistent', ctx.toolContractHash?.('weaver'));
      return get(a.id);
    },

    spawnForTicket(actor: Actor, ticketId: string): Promise<Agent> { return spawn(actor, ticketId); },

    ensureWorktree,

    async ensurePlanner(actor: Actor, planId: string, opts: { agentId?: string } = {}): Promise<Agent> {
      const plan = deps().planning.get(planId);
      const existing = ctx.db.get<Agent>(`SELECT * FROM agents WHERE plan_id = ? AND kind = 'planner' AND status IN ${LIVE}`, [planId]);
      if (existing) return existing;
      const project = projectOf(plan.projectId);
      const setting = modelSettingFor(modelsFor(ctx), 'planner');

      // VS-398: `opts.agentId` lets `startOrResumePlan` mint the agent id up front, so it can create
      // the plan's own thread (whose `agent_id` is NOT NULL) before this agent row exists — otherwise
      // thread, plan and agent each need one of the other two to exist first.
      const id = opts.agentId ?? newId();
      const home = join(ctx.paths.workers, id);
      const now = nowIso();
      const branch = planBranch(plan);
      const spawnedBy = actor.kind === 'human' ? 'human' : actor.kind === 'agent' ? 'weaver' : 'system';

      ctx.db.insert('agents', {
        id, workspaceId: ctx.workspaceId, kind: 'planner', projectId: project.id, roleId: null, roleRevision: null,
        ticketId: null, planId: plan.id, name: `Planner — ${projectLabel(project)}`, runtimeId: setting.runtime,
        status: 'provisioning', homePath: home, worktreePath: null, branch: null,
        turnEpoch: 0, turnCount: 0, spawnedBy, spawnReason: `plan ${plan.id}`,
        briefRevision: 1, createdAt: now, updatedAt: now,
      });

      let worktreeRowId: string | null = null;
      try {
        mkdirSync(home, { recursive: true });
        const identity = await requireGitIdentity(project.clonePath);
        const provider = providerFor(project);
        const targetPath = join(home, 'work');
        // VS-398: a disposable checkout, never the project's shared clone — isolated from concurrent
        // daemon fetch/landing operations, and never committed to or opened as a pull request.
        const info = await provider.create({
          repoPath: project.clonePath, branch, base: landingBranchOf(project), targetPath, configPath: ctx.paths.wtConfig,
        });
        await configureGitWorktreeIdentity(project.clonePath, info.path, identity);
        worktreeRowId = newId();
        ctx.db.insert('worktrees', {
          id: worktreeRowId, projectId: project.id, ticketId: null, agentId: id, provider: provider.id,
          path: info.path, branch: info.branch || branch, status: 'active', createdAt: now, lastVerifiedAt: now,
        });
        ctx.db.update('agents', id, { worktreePath: info.path, branch: info.branch || branch, updatedAt: nowIso() });

        const agent = get(id);
        await renderHome(ctx, deps, agent);
        ctx.db.update('agents', id, { status: 'active', updatedAt: nowIso() });
        sessions.forTurn({ id, kind: 'planner', runtimeId: setting.runtime }, 'persistent', ctx.toolContractHash?.('planner'));
        deps().planning.setAgent(plan.id, id);
        // VS-567: a replacement planner takes over the plan's existing conversation.
        ctx.db.run('UPDATE channel_threads SET agent_id = ? WHERE id = ? AND agent_id != ?', [id, plan.threadId, id]);
      } catch (e) {
        log.error({ err: String(e), planId }, 'planner spawn failed; rolling back');
        try {
          const provider = providerFor(project);
          await provider.remove({ repoPath: project.clonePath, path: join(home, 'work'), branch, deleteBranch: true, force: true, configPath: ctx.paths.wtConfig }).catch(() => undefined);
        } catch { /* best effort */ }
        if (worktreeRowId) ctx.db.run('DELETE FROM worktrees WHERE id = ?', [worktreeRowId]);
        ctx.db.run('DELETE FROM agent_sessions WHERE agent_id = ?', [id]);
        ctx.db.run('DELETE FROM agents WHERE id = ?', [id]);
        try { rmSync(home, { recursive: true, force: true }); } catch { /* leave the directory for inspection */ }
        throw e instanceof OcError ? e : new OcError('internal', `planner spawn failed: ${String(e)}`);
      }

      const agent = get(id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.spawn', 'agent', id, { planId: plan.id, projectId: project.id, branch });
      ctx.events.emit('worker.spawned', 'agent', id, { name: agent.name, kind: 'planner', planId: plan.id, projectId: project.id, branch: agent.branch });
      log.info({ plannerId: id, planId }, 'planner spawned');
      return agent;
    },

    async retirePlanner(planId: string): Promise<void> {
      const agent = ctx.db.get<Agent>(`SELECT * FROM agents WHERE plan_id = ? AND kind = 'planner' AND status IN ${LIVE}`, [planId]);
      if (!agent) return;
      if (agent.projectId && agent.worktreePath && agent.branch) {
        const project = projectOf(agent.projectId);
        const provider = providerFor(project);
        await provider.remove({ repoPath: project.clonePath, path: agent.worktreePath, branch: agent.branch, deleteBranch: true, force: true, configPath: ctx.paths.wtConfig }).catch(() => undefined);
        ctx.db.run("UPDATE worktrees SET status = 'removed', removed_at = ? WHERE agent_id = ?", [nowIso(), agent.id]);
      }
      ctx.db.update('agents', agent.id, { status: 'retired', retiredAt: nowIso(), updatedAt: nowIso() });
      ctx.db.run('DELETE FROM wakeups WHERE agent_id = ?', [agent.id]);
      deps().planning.setAgent(planId, null);
      ctx.events.emit('worker.retired', 'agent', agent.id, { kind: 'planner', planId });
    },

    /**
     * VS-495: a role's persistent session — long-lived, no ticket, no worktree until the human asks
     * for one (see `takeTicketForSession`). Returns the existing live session for the role if there
     * is one (mirrors `ensurePlanner`'s "do not create a second agent"), otherwise creates it.
     */
    async ensureSession(actor: Actor, projectId: string, roleId: string, workerModelId?: string | null): Promise<{ agent: Agent; thread: ChannelThread }> {
      const project = projectOf(projectId);
      const role = ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [roleId]);
      if (!role || role.projectId !== project.id) throw new OcError('not_found', `role ${roleId} not found in project ${project.slug}`);
      // VS-526: validate the chosen option the same way a ticket's is, before anything is created.
      const optionId = resolveWorkerModelOption(effectiveModels(ctx.daemon, ctx.config), workerModelId);
      const existing = ctx.db.get<Agent>(`SELECT * FROM agents WHERE role_id = ? AND kind = 'session' AND status IN ${LIVE}`, [roleId]);
      if (existing) {
        const thread = deps().threads.list({ agentId: existing.id })[0];
        if (!thread) throw new OcError('internal', `session ${existing.id} has no thread`);
        // VS-526: self-heal a session opened before the home was a repository, so opening it again
        // (not only creating it) leaves a runtime that requires one able to start.
        await ensureSessionRepo(existing.homePath);
        return { agent: existing, thread };
      }

      const id = newId();
      const home = join(ctx.paths.workers, id);
      const now = nowIso();
      const spawnedBy = actor.kind === 'human' ? 'human' : actor.kind === 'agent' ? 'weaver' : 'system';
      const thread = deps().threads.createOwned(id, { humanLabel: `${role.name} — persistent session` });

      ctx.db.insert('agents', {
        id, workspaceId: ctx.workspaceId, kind: 'session', projectId: project.id, roleId: role.id, roleRevision: role.specRevision,
        ticketId: null, name: `${role.name} — session`,
        runtimeId: modelSettingFor(modelsFor(ctx), 'session', null, { workerModelId: optionId }).runtime,
        workerModelId: optionId,
        status: 'provisioning', homePath: home, worktreePath: null, branch: null,
        turnEpoch: 0, turnCount: 0, spawnedBy, spawnReason: `role ${role.id}`,
        briefRevision: 1, createdAt: now, updatedAt: now,
      });
      mkdirSync(home, { recursive: true });
      await ensureSessionRepo(home);
      const agent = get(id);
      await renderHome(ctx, deps, agent);
      ctx.db.update('agents', id, { status: 'active', updatedAt: nowIso() });
      const setting = modelSettingFor(modelsFor(ctx), 'session', null, { workerModelId: optionId });
      sessions.forTurn({ id, kind: 'session', runtimeId: setting.runtime }, 'persistent', ctx.toolContractHash?.('session'));

      const created = get(id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.spawn', 'agent', id, { roleId: role.id, projectId: project.id, kind: 'session' });
      ctx.events.emit('worker.spawned', 'agent', id, { name: created.name, kind: 'session', roleId: role.id, projectId: project.id });
      log.info({ sessionAgentId: id, roleId: role.id }, 'persistent session opened');
      return { agent: created, thread };
    },

    async takeTicketForSession(actor: Actor, sessionId: string, input: TicketCreateInput | { ticketId: string }): Promise<{ agent: Agent; ticket: Ticket }> {
      const session = get(sessionId);
      if (session.kind !== 'session') throw new OcError('validation', `${sessionId} is not a persistent session`);
      if (session.ticketId) throw new OcError('wrong_status', `session ${sessionId} already holds a ticket ${session.ticketId}`);
      if (!session.roleId || !session.projectId) throw new OcError('internal', `session ${sessionId} has no role or project`);

      // VS-495: `supervisor.spawnPending()` sweeps every tick for a ticket with `assignee_role_id`
      // set and `worker_id` NULL, and its `liveWorkerFor()` guard only recognises `kind='worker'`
      // agents — invisible to this session. Assigning the role and binding `worker_id` must happen
      // synchronously, with no `await` between them, or that sweep can spawn a competing transient
      // worker on this exact ticket before this function reaches the `await` below. `tickets.create`
      // and `tickets.assign` are both plain synchronous DB calls (`tx()`), so this is safe as written
      // — do not introduce an `await` between either of them and the `worker_id` UPDATE.
      let ticket: Ticket;
      if ('ticketId' in input) {
        ticket = ticketOf(input.ticketId);
        if (ticket.workerId) throw new OcError('conflict', `ticket ${ticket.identifier} already has a worker`);
        if (ticket.assigneeRoleId && ticket.assigneeRoleId !== session.roleId) {
          throw new OcError('validation', `ticket ${ticket.identifier} is assigned to a different role`, { roleId: ticket.assigneeRoleId });
        }
        if (!ticket.assigneeRoleId) ticket = deps().tickets.assign(actor, ticket.id, session.roleId);
        ctx.db.run('UPDATE tickets SET worker_id = ?, updated_at = ? WHERE id = ?', [session.id, nowIso(), ticket.id]);
      } else {
        ticket = deps().tickets.create(actor, { ...input, assigneeRoleId: session.roleId });
        ctx.db.run('UPDATE tickets SET worker_id = ?, updated_at = ? WHERE id = ?', [session.id, nowIso(), ticket.id]);
      }
      // Everything from here on may freely `await` — the ticket is already bound to this session's
      // agent id, so `spawnPending()`'s own `worker_id IS NULL` filter already excludes it.
      ticket = ticketOf(ticket.id);

      const role = ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [session.roleId]);
      if (!role) throw new OcError('not_found', `role ${session.roleId} not found`);
      const project = projectOf(session.projectId);
      const branch = ticketBranch(ticket);
      // VS-636: record the branch before provisioning, so a take-ticket cut off by a restart is
      // recognisable as an agent that owes a checkout and the boot sweep can finish it.
      ctx.db.update('agents', session.id, { ticketId: ticket.id, branch, updatedAt: nowIso() });

      let worktreeRowId: string | null = null;
      try {
        ({ worktreeRowId } = await provisionTicketWorktree(session.id, session.homePath, project, ticket, branch));
        if (ticket.kind === 'change' && project.openspecEnabled && !ticket.openspecChangeName) {
          ctx.db.run('UPDATE tickets SET openspec_change_name = ? WHERE id = ?', [openspecChangeName(ticket), ticket.id]);
        }
        if (ticket.status === 'backlog') {
          try { await deps().tickets.transition({ kind: 'system', id: null }, ticket.id, { to: 'todo', note: 'persistent session took the ticket' }); }
          catch { ctx.db.run("UPDATE tickets SET status = 'todo', updated_at = ? WHERE id = ?", [nowIso(), ticket.id]); }
        }
        const agent = get(session.id);
        await renderHome(ctx, deps, agent);
        deps().wake.enqueue(session.id, { source: 'ticket_assigned', reason: `${ticket.identifier}: ${ticket.title}`, payload: { ticketId: ticket.id }, requestedBy: actor });
      } catch (e) {
        log.error({ err: String(e), ticketId: ticket.id, sessionId }, 'session take-ticket failed; rolling back');
        await removeTicketWorktree(session.homePath, project, branch, worktreeRowId);
        ctx.db.run('UPDATE tickets SET worker_id = NULL, updated_at = ? WHERE id = ?', [nowIso(), ticket.id]);
        ctx.db.update('agents', session.id, { ticketId: null, worktreePath: null, branch: null, updatedAt: nowIso() });
        throw e instanceof OcError ? e : new OcError('internal', `session take-ticket failed: ${String(e)}`);
      }

      const finalTicket = ticketOf(ticket.id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.spawn', 'agent', session.id, { ticketId: ticket.id, roleId: role.id, branch }, ticket.id);
      log.info({ sessionAgentId: session.id, ticket: finalTicket.identifier }, 'persistent session took a ticket');
      return { agent: get(session.id), ticket: finalTicket };
    },

    /**
     * VS-495: called when a persistent session's ticket reaches a terminal status — the session is
     * NOT retired (unlike a worker on a terminal ticket): it returns to being an idle, ticketless
     * session, ready for its next conversation turn or its next ticket. The worktree is marked
     * `dirty` rather than removed: whether it is safe to delete (has the branch actually landed?) is
     * exactly what `retireIfLanded` exists to determine for a worker, and reusing that judgement here
     * is future work, not something to approximate by deleting a worktree that might hold uncommitted
     * or unlanded changes.
     */
    async releaseSessionTicket(actor: Actor, sessionId: string): Promise<void> {
      const session = get(sessionId);
      if (session.kind !== 'session' || !session.ticketId) return;
      try { deps().wake.cancelForAgent(session.id, `${session.ticketId}: ticket reached a terminal status`); }
      catch (e) { log.warn({ err: String(e), sessionId }, 'cancelling wakes for a terminal session ticket failed'); }
      const running = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [session.id]);
      if (running) { const runId = running.id; void deps().runs.cancel(actor, runId, 'interrupt').catch(() => undefined); }
      ctx.db.run("UPDATE worktrees SET status = 'dirty' WHERE agent_id = ? AND status = 'active'", [session.id]);
      ctx.db.update('agents', session.id, { ticketId: null, worktreePath: null, branch: null, updatedAt: nowIso() });
      const agent = get(session.id);
      await renderHome(ctx, deps, agent);
      ctx.events.emit('worker.status', 'agent', session.id, { status: 'active', reason: 'returned to ticketless conversation' });
      log.info({ sessionAgentId: session.id }, 'persistent session returned to ticketless conversation');
    },

    /**
     * VS-526: set (or clear) the worker option a persistent session runs on. The option is validated
     * against the effective catalog exactly as a ticket's is; `agent.runtimeId` is updated to the
     * resolved runtime so `sessions.forTurn` retires the current session when the runtime moves (the
     * new session is created on the next turn), and keeps it when only the model or effort changed.
     */
    async setSessionOption(actor: Actor, sessionId: string, workerModelId: string | null): Promise<Agent> {
      const session = get(sessionId);
      if (session.kind !== 'session') throw new OcError('validation', `${sessionId} is not a persistent session`);
      const optionId = resolveWorkerModelOption(effectiveModels(ctx.daemon, ctx.config), workerModelId);
      const setting = modelSettingFor(modelsFor(ctx), 'session', null, { workerModelId: optionId });
      ctx.db.update('agents', session.id, { workerModelId: optionId, runtimeId: setting.runtime, updatedAt: nowIso() });
      const updated = get(session.id);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.status', 'agent', session.id, { workerModelId: optionId, runtimeId: setting.runtime });
      ctx.events.emit('worker.status', 'agent', session.id, { status: updated.status, workerModelId: optionId, runtimeId: setting.runtime });
      log.info({ sessionAgentId: session.id, workerModelId: optionId, runtimeId: setting.runtime }, 'persistent session option changed');
      return updated;
    },

    async createPlan(actor: Actor, projectId: string, opts: { title?: string | null } = {}): Promise<{ plan: Plan; agent: Agent }> {
      const project = projectOf(projectId);
      // The thread needs an owning agent id before the agent row can exist (its FK is NOT NULL), and
      // the agent needs a plan id before it can be spawned, and the plan needs the thread id before
      // it can be created — so the agent id is minted here, up front, and handed to `ensurePlanner`
      // to use instead of minting its own.
      const plannerAgentId = newId();
      const thread = deps().threads.createOwned(plannerAgentId, opts.title ? { humanLabel: opts.title } : {});
      const plan = deps().planning.create(actor, project.id, { threadId: thread.id, title: opts.title ?? null });
      const agent = await service.ensurePlanner(actor, plan.id, { agentId: plannerAgentId });
      return { plan, agent };
    },

    async startOrResumePlan(actor: Actor, projectId: string, opts: { title?: string | null } = {}): Promise<{ plan: Plan; agent: Agent }> {
      const project = projectOf(projectId);
      // VS-477: several drafting plans may exist; resume the most recently created one.
      const existing = deps().planning.getDrafting(project.id);
      if (existing) {
        const agent = await service.ensurePlanner(actor, existing.id);
        return { plan: existing, agent };
      }
      return service.createPlan(actor, project.id, opts);
    },

    async retireIdlePlanners(projectId: string, opts: { keepPlanId?: string | null; idleMs?: number } = {}): Promise<number> {
      const project = projectOf(projectId);
      const idleMs = opts.idleMs ?? PLANNER_IDLE_RETIRE_MS;
      const rows = ctx.db.all<Agent & { planUpdatedAt: string | null }>(
        `SELECT a.*, p.updated_at AS plan_updated_at
           FROM agents a JOIN plans p ON p.id = a.plan_id
          WHERE a.project_id = ? AND a.kind = 'planner' AND a.status IN ${LIVE} AND a.plan_id IS NOT NULL`,
        [project.id],
      );
      const now = Date.now();
      let retired = 0;
      for (const a of rows) {
        if (opts.keepPlanId && a.planId === opts.keepPlanId) continue;
        // Never retire a planner mid-turn, and never one that was active within the idle window.
        if (a.status === 'running') continue;
        const lastRun = a.lastRunAt ? Date.parse(a.lastRunAt) : Number.NaN;
        const reference = Number.isFinite(lastRun) ? lastRun : Date.parse(a.planUpdatedAt ?? a.createdAt);
        if (!Number.isFinite(reference) || now - reference < idleMs) continue;
        await service.retirePlanner(a.planId!);
        retired += 1;
      }
      return retired;
    },

    async spawnCurator(actor: Actor, projectId: string): Promise<Agent> {
      const project = projectOf(projectId);
      const role = ctx.db.get<Role>("SELECT * FROM roles WHERE project_id = ? AND status = 'active' ORDER BY created_at LIMIT 1", [projectId]);
      if (!role) throw new OcError('wrong_status', `project ${project.slug} has no active role to curate its knowledge`);
      const ticket = deps().tickets.create(actor, {
        projectId, kind: 'task', title: `Curate project knowledge (${projectLabel(project)})`,
        description: 'Curate this project\'s knowledge base: merge duplicates, fold learnings that became conventions, archive stale entries, keep every section within budget. Never invent facts. Submit with `weave_knowledge_replace`.',
        priority: 'low', assigneeRoleId: role.id, originKind: 'curation', originFingerprint: `curation:${projectId}`,
      });
      // VS-358: an opted-in project's curation delivers through the project's normal review, which
      // needs a worktree and branch to commit onto; an opted-out project keeps today's read-only,
      // worktree-less spawn.
      return spawn(actor, ticket.id, { noWorktree: !project.knowledgeRepoEnabled, spawnReason: 'knowledge curation' });
    },

    /**
     * Start an interactive session (VS-101): a session always has a ticket, so this is the ordinary
     * `spawn` with one extra step — mark the ticket as a session, either an existing one or one
     * created in the same action. Nothing about provisioning differs from a worker's.
     */
    async startInteractiveSession(actor: Actor, input: { ticketId: string } | { projectId: string; roleId: string; kind: Ticket['kind']; title: string; description?: string }): Promise<Agent> {
      let ticket: Ticket;
      if ('ticketId' in input) {
        ticket = ticketOf(input.ticketId);
        if (!ticket.interactiveSession) {
          ctx.db.update('tickets', ticket.id, { interactiveSession: true, updatedAt: nowIso() });
          ticket = ticketOf(ticket.id);
        }
      } else {
        ticket = deps().tickets.create(actor, {
          projectId: input.projectId, kind: input.kind, title: input.title, description: input.description,
          assigneeRoleId: input.roleId, interactiveSession: true,
        });
      }
      return spawn(actor, ticket.id);
    },

    async message(actor: Actor, workerId: string, body: string, opts: { live?: boolean; dictated?: boolean } = {}): Promise<WorkerMessageOutcome> {
      const agent = get(workerId);
      if (!agent.ticketId) throw new OcError('validation', `${agent.name} has no ticket to talk on`);
      // A retired worker will never take another turn: recording a comment and queuing a wake for
      // it would misstate what happened as delivered-or-queued when nobody will ever read it.
      // Reopening the ticket with a plain comment is the real way back in (VS-106).
      if (agent.status === 'retired') {
        throw new OcError('wrong_status', `${agent.name} has retired; reply on the ticket to reopen it instead`);
      }
      const ticket = ticketOf(agent.ticketId);
      // The conductor already has a live path to any worker (`weave_worker_message`) — an interactive
      // session is the human's own conversation, so the conductor is refused here, not given a
      // narrower tool list (VS-101). A human actor is never affected by this check.
      if (actor.kind === 'agent' && ticket.interactiveSession) {
        throw new OcError('forbidden', `${agent.name}'s ticket is an interactive session; the conductor cannot message it directly`);
      }
      // Attribution first (VS-99): the human's words are on the ticket before any delivery is
      // attempted, so a failed or throwing send still leaves a durable record.
      if (opts.dictated) deps().tickets.comment(actor, agent.ticketId, body, 'relay', actor.kind === 'human' ? 'trusted' : 'agent', { dictated: true });
      else deps().tickets.comment(actor, agent.ticketId, body, 'relay', actor.kind === 'human' ? 'trusted' : 'agent');

      let delivery: 'mid_turn' | 'queued' | 'interrupted' = 'queued';
      let runId: string | null = null;
      if (opts.live) {
        for (const active of runState(ctx).active.values()) {
          if (active.agentId !== workerId) continue;
          if (active.send) {
            runId = active.runId;
            try { if ((await active.send(withDictatedNotice(body, opts.dictated))) === 'delivered') delivery = 'mid_turn'; }
            catch { /* the runtime could not take it; falls through to queued */ }
          } else if (actor.kind === 'human') {
            // The runtime cannot take mid-turn input, but a human explicitly asked for live
            // delivery: interrupt the running turn and deliver via the next one instead of queuing
            // behind it (VS-254). A live send on the conductor's behalf (`weave_worker_message`) leaves
            // the turn alone, exactly as before this change — see design.md Decision 1.
            runId = active.runId;
            delivery = 'interrupted';
            await deps().runs.cancel(actor, active.runId, 'interrupt', 'message');
          }
          break;
        }
      }
      // Between turns (or no live attempt), attach the transcript entry to the most recent run —
      // there is nothing else to attach it to until the next turn starts.
      if (!runId) {
        runId = ctx.db.get<{ id: string }>('SELECT id FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1', [workerId])?.id ?? null;
      }
      if (runId) recordHumanInputEvent(ctx, runId, { text: body, authorKind: actor.kind, authorId: actor.id, delivery });

      // A message the running turn already has must not also be queued — that would deliver it twice.
      let wake: ReturnType<CoreServices['wake']['enqueue']> | null = null;
      if (delivery === 'interrupted') {
        // A human's words ride whole — the reason carries the entire message, so the turn prompt
        // needs no `weave_inbox` round trip to read it. `tickets.comment(...)` above already recorded
        // the same untruncated body as a ticket comment, whatever becomes of this delivery.
        wake = deps().wake.enqueue(workerId, {
          source: 'live_interrupt', reason: body,
          payload: { ticketId: agent.ticketId, message: body, interruptedRunId: runId, ...(opts.dictated ? { dictated: true } : {}) },
          requestedBy: actor,
        });
      } else if (delivery === 'queued') {
        wake = deps().wake.enqueue(workerId, { source: 'conductor_request', reason: body.slice(0, 160), payload: { ticketId: agent.ticketId, message: body, ...(opts.dictated ? { dictated: true } : {}) }, requestedBy: actor });
      }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.message', 'agent', workerId, { length: body.length, delivery }, agent.ticketId);
      return { delivery, runId, wake };
    },

    async relaunch(actor: Actor, workerId: string, note: string): Promise<Agent & { notice?: string }> {
      const agent = get(workerId);
      // A worker parked after a failure is not stuck, it is waiting on a human: relaunching it is a
      // resume (VS-56). Its session, ticket, worktree and brief all stand, so there is nothing to
      // re-render and no progress to re-derive.
      if (agent.status === 'paused' && agent.pauseDetail) return service.resume(actor, workerId);
      // VS-375: a shut-down cut already left this turn's wake queued; the dispatcher will resume it.
      // Bumping the brief, re-rendering the home and enqueuing another wake would look like a relaunch
      // (and coalesce into the same wake), so report the wait instead.
      if (preservedResumeQueued(ctx, workerId)) {
        return { ...agent, notice: 'already queued; waiting for a run slot' };
      }
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) ?? null : null;
      const active = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [workerId]);
      if (active) { try { await deps().runs.cancel(actor, active.id, 'kill'); } catch { /* already gone */ } }
      // VS-636: a worker that owes a checkout is repaired before it goes back to work — a relaunch
      // must never mark it active with a null (or vanished) worktree path. A failure propagates, so
      // the caller sees the cause instead of a silently checkoutless worker.
      if (agentNeedsCheckout(agent) && !(agent.worktreePath && existsSync(agent.worktreePath))) await ensureWorktree(workerId);
      const current = get(workerId);
      const derived = await progressNote(current, ticket);
      const relaunchNote = [note, derived].filter(Boolean).join(' ');
      ctx.db.update('agents', workerId, { briefRevision: current.briefRevision + 1, status: 'active', errorText: null, updatedAt: nowIso() });
      // VS-625: a relaunch is the other way a worker goes back to work (a parked worker took the
      // resume branch above); its stop cards are just as stale. Best effort, like the resume path.
      try {
        deps().decisions.supersedeWorkerStopCards(actor, workerId, `the worker was relaunched by ${resumerLabel(actor)} at ${nowIso()}`);
      } catch (e) { log.warn({ workerId, err: String(e) }, 'closing the worker\'s stop cards on relaunch failed'); }
      const updated = get(workerId);
      await renderHome(ctx, deps, updated, { relaunchNote });
      deps().wake.enqueue(workerId, { source: 'system', reason: 'relaunch', payload: { relaunchNote }, requestedBy: actor });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.relaunch', 'agent', workerId, { note: relaunchNote.slice(0, 400) }, agent.ticketId);
      ctx.events.emit('worker.relaunched', 'agent', workerId, { note: relaunchNote.slice(0, 400) });
      log.info({ workerId }, 'worker relaunched');
      return get(workerId);
    },

    async cancel(actor: Actor, workerId: string, reason: string): Promise<Agent> {
      const agent = get(workerId);
      const active = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [workerId]);
      if (active) { try { await deps().runs.cancel(actor, active.id, 'interrupt'); } catch { /* already gone */ } }
      deps().wake.cancelForAgent(workerId, `worker cancelled: ${reason}`);
      ctx.db.update('agents', workerId, { status: 'done', errorText: reason, updatedAt: nowIso() });
      // The worktree stays until the work lands or a human approves a discard (PLAN §11.5).
      ctx.db.run("UPDATE worktrees SET status = 'dirty' WHERE agent_id = ? AND status = 'active'", [workerId]);
      if (agent.ticketId) {
        try { deps().tickets.comment({ kind: 'system', id: null }, agent.ticketId, `${agent.name} was cancelled: ${reason}. Its branch and worktree are kept until the work lands or is discarded.`, 'status', 'trusted'); } catch { /* comment is best effort */ }
      }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.cancel', 'agent', workerId, { reason }, agent.ticketId);
      ctx.events.emit('worker.status', 'agent', workerId, { status: 'done', reason });
      return get(workerId);
    },

    pause(actor: Actor, id: string, reason: string): Agent {
      get(id);
      // A human's pause carries its reason and no failure family; any structured detail a previous
      // failure left is stale the moment someone pauses it by hand.
      ctx.db.update('agents', id, { status: 'paused', pauseReason: reason, pauseDetailJson: null, updatedAt: nowIso() });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.pause', 'agent', id, { reason });
      ctx.events.emit('worker.status', 'agent', id, { status: 'paused', reason });
      return get(id);
    },

    /**
     * Put a paused worker back to work: same ticket, same worktree, same branch, same session. Until
     * VS-56 this only flipped the column, so the endpoint, the CLI verb and the web button all did
     * nothing — the dispatcher had no wake to claim. Each step is guarded on its own so a failure to
     * unblock the ticket does not cost the worker its turn.
     */
    resume(actor: Actor, id: string): Agent {
      const agent = get(id);
      // A worker stopped by its runtime's expired login cannot be resumed into a working turn: the
      // dispatcher will not start one while the runtime is gated, and the credential is still the
      // dead one. It resumes by itself when the login is restored (VS-75). The runtime that decides
      // is the one its next turn would run on — the workspace's setting, not the row the gate
      // stamped, which VS-77 may have left pointing at a runtime nothing runs on anymore.
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) : null;
      const runtimeId = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent).runtime;
      if (waitingOnRuntimeLogin(agent) && gatedRuntime(runtimeId)) {
        throw new OcError('conflict', `${agent.name} is waiting on the ${runtimeId} login, not on you. Log that CLI in again and it resumes on its own.`, { runtimeId }, true);
      }
      // A human holds this session (VS-249): plain resume would dispatch a turn into a worktree and
      // session the human may still be using, or may have changed without the daemon's knowledge.
      // Only `endHandover` (or the supervisor's own abandonment sweep) may put this worker back to
      // work — see the `run-recovery/paused-worker-visibility` delta.
      if (heldByHuman(agent)) {
        throw new OcError('wrong_status', `${agent.name}'s session is held by a human; give it back instead of resuming it`);
      }
      const wasPaused = agent.status === 'paused';
      ctx.db.update('agents', id, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: nowIso() });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.resume', 'agent', id, {});
      ctx.events.emit('worker.status', 'agent', id, { status: 'active' });
      if (!wasPaused) return get(id);

      // VS-625: the worker is back at work, so any card that said it was stopped is stale — the
      // human could answer it and start a second turn on top of this one. Close them first; a
      // failure here must not cost the worker its turn, so it is best effort.
      try {
        deps().decisions.supersedeWorkerStopCards(actor, id, `the worker was resumed by ${resumerLabel(actor)} at ${nowIso()}`);
      } catch (e) { log.warn({ workerId: id, err: String(e) }, 'closing the worker\'s stop cards on resume failed'); }

      // Idempotent per turn: resuming twice before the worker runs coalesces into the same wake.
      try {
        deps().wake.enqueue(id, {
          source: 'system', reason: 'resumed', payload: { resumed: true },
          idempotencyKey: `resume:${id}:${agent.turnEpoch}`, requestedBy: actor,
        });
      } catch (e) { log.error({ workerId: id, err: String(e) }, 'resuming the worker could not queue its turn'); }

      if (ticket?.status === 'blocked') {
        void deps().tickets.transition(actor, ticket.id, {
          to: (ticket.blockedFromStatus ?? 'todo') as TicketStatus,
          note: `${agent.name} was resumed`,
        }).catch((e: unknown) => log.warn({ workerId: id, ticketId: ticket.id, err: String(e) }, 'resuming the worker could not unblock its ticket'));
      }
      try {
        deps().wake.enqueue(service.conductor().id, {
          source: 'system', reason: `${agent.name} was resumed${ticket ? ` on ${ticket.identifier}` : ''}`,
          payload: { kind: 'worker_resumed', workerId: id, ticketId: agent.ticketId },
          idempotencyKey: `worker_resumed:${id}:${agent.turnEpoch}`, requestedBy: actor,
        });
      } catch { /* no conductor yet, or its queue is busy; the digest carries the event anyway */ }
      log.info({ workerId: id }, 'worker resumed');
      return get(id);
    },

    async retireIfLanded(actor: Actor, workerId: string): Promise<{ retired: boolean; reason?: string }> {
      const agent = get(workerId);
      if (agent.status === 'retired') return { retired: true };
      const project = agent.projectId ? projectOf(agent.projectId) : null;
      const ticket = agent.ticketId ? ticketOf(agent.ticketId) : null;
      const wt = ctx.db.get<{ id: string; path: string; branch: string; status: string }>("SELECT id, path, branch, status FROM worktrees WHERE agent_id = ? AND status != 'removed' ORDER BY created_at DESC LIMIT 1", [workerId]);

      // VS-333: a kept worker stays `done`, and the reason is recorded so the Roles page can show it.
      const refuse = (reason: string, worktreeId?: string): { retired: false; reason: string } => {
        if (agent.status === 'done') ctx.db.update('agents', workerId, { errorText: reason, updatedAt: nowIso() });
        if (worktreeId) ctx.db.update('worktrees', worktreeId, { status: 'dirty', lastVerifiedAt: nowIso() });
        return { retired: false, reason };
      };
      let archivedUntracked: string[] = [];

      if (project && wt) {
        // Merged-PR evidence from the stored record, refreshed from the forge for a terminal ticket
        // before deciding (VS-333) — a squash-merged PR whose record is stale `open` then passes the
        // patch-id path. Throttled: see PR_REFRESH_WINDOW_MS.
        let merged = false;
        if (agent.ticketId) {
          const wp = ctx.db.get<{ id: string; url: string; state: string | null }>(
            "SELECT id, url, state FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
            [agent.ticketId],
          );
          merged = (wp?.state ?? '').toLowerCase() === 'merged';
          if (wp && !merged && ticket && TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
            const last = prRefreshedAt.get(workerId) ?? 0;
            if (Date.now() - last >= PR_REFRESH_WINDOW_MS) {
              prRefreshedAt.set(workerId, Date.now());
              const forge = ctx.registries.forges.get('github');
              if (forge) {
                const pr = await forge.prState(project.clonePath, wp.url).catch((e: unknown) => {
                  log.warn({ workerId, url: wp.url, err: String(e) }, 'PR state refresh before retirement failed');
                  return null;
                });
                if (pr?.state === 'merged') {
                  merged = true;
                  ctx.db.run('UPDATE ticket_work_products SET state = ?, updated_at = ? WHERE id = ?', [pr.state, nowIso(), wp.id]);
                }
              }
            }
          }
        }

        const policies = (project.policies ?? {}) as { deliveryMode?: string };
        const verdict = await landedWorkTest({
          repoPath: project.clonePath, worktreePath: wt.path, branch: wt.branch, landingBranch: landingBranchOf(project, ticket),
          mergedPr: merged, localBranch: (policies.deliveryMode ?? ctx.config.defaults.deliveryMode) === 'local-branch',
        });
        if (!verdict.landed) {
          ctx.db.update('worktrees', wt.id, { status: 'dirty', lastVerifiedAt: nowIso(), landedEvidenceJson: verdict.evidence });
          log.info({ workerId, reason: verdict.reason }, 'worker not retired: work has not landed');
          return refuse(verdict.reason);
        }

        // The verdict proved no tracked edits a moment ago; re-check before the forced removal so a
        // file saved in between is never discarded unarchived.
        const untracked = verdict.untrackedFiles ?? [];
        if (untracked.length) {
          const recheck = await worktreeChanges(wt.path);
          if (!recheck.ok || recheck.tracked.length) {
            const reason = recheck.ok ? `${recheck.tracked.length} uncommitted change(s) in the worktree` : 'cannot read worktree status';
            return refuse(reason, wt.id);
          }
        }

        // Copy untracked leftovers into the archive before the worktree is removed (VS-333). If any
        // copy fails, refuse rather than force-remove a file that was not kept.
        const archived: string[] = [];
        if (untracked.length) {
          for (const rel of untracked) {
            const dest = join(ctx.paths.archive, workerId, 'untracked', rel);
            try {
              mkdirSync(dirname(dest), { recursive: true });
              cpSync(join(wt.path, rel), dest, { recursive: true, force: true });
              archived.push(rel);
            } catch (e) {
              log.warn({ workerId, file: rel, err: String(e) }, 'archiving an untracked file failed');
            }
          }
          if (archived.length !== untracked.length) {
            return refuse(`${untracked.length - archived.length} untracked file(s) could not be archived`, wt.id);
          }
        }

        try {
          const provider = providerFor(project);
          await provider.remove({ repoPath: project.clonePath, path: wt.path, branch: wt.branch, deleteBranch: true, force: untracked.length > 0, configPath: ctx.paths.wtConfig });
        } catch (e) {
          ctx.db.update('worktrees', wt.id, { status: 'dirty', lastVerifiedAt: nowIso() });
          return refuse(`worktree removal failed: ${String(e)}`);
        }
        ctx.db.update('worktrees', wt.id, { status: 'removed', removedAt: nowIso(), lastVerifiedAt: nowIso(), landedEvidenceJson: verdict.evidence });
        archivedUntracked = archived;

        if (archived.length && agent.ticketId) {
          try { deps().tickets.comment({ kind: 'system', id: null }, agent.ticketId, archivedComment(ctx.paths.archive, workerId, archived), 'status', 'trusted'); }
          catch (e) { log.warn({ workerId, err: String(e) }, 'posting the archived-files comment failed'); }
        }
      }

      // Archive the home (brief, notes, final report); run logs stay under .weave/runs. When untracked
      // files were archived first the directory already exists, so merge into it.
      const archive = join(ctx.paths.archive, workerId);
      try {
        if (existsSync(agent.homePath)) {
          mkdirSync(join(archive, '..'), { recursive: true });
          try { renameSync(agent.homePath, archive); }
          catch { cpSync(agent.homePath, archive, { recursive: true }); rmSync(agent.homePath, { recursive: true, force: true }); }
        }
      } catch (e) { log.warn({ workerId, err: String(e) }, 'archiving the worker home failed'); }

      sessions.close(workerId);
      deps().wake.cancelForAgent(workerId, 'worker retired');
      ctx.db.update('agents', workerId, { status: 'retired', retiredAt: nowIso(), homePath: archive, updatedAt: nowIso() });
      if (agent.ticketId) ctx.db.run('UPDATE tickets SET worker_id = NULL WHERE id = ? AND worker_id = ?', [agent.ticketId, workerId]);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.retire', 'agent', workerId,
        archivedUntracked.length ? { archivedUntracked: cappedFileList(archivedUntracked).files, archivedUntrackedTotal: archivedUntracked.length } : {},
        agent.ticketId);
      ctx.events.emit('worker.retired', 'agent', workerId, { ticketId: agent.ticketId, name: agent.name });
      log.info({ workerId }, 'worker retired');
      return { retired: true };
    },

    sessionResumable(id: string): boolean {
      return sessions.active(id) !== null;
    },

    brief(workerId: string): string {
      const agent = get(workerId);
      const path = join(agent.homePath, 'brief.md');
      if (existsSync(path)) return readFileSync(path, 'utf8');
      return renderBrief(ctx, deps, agent);
    },

    async resetSession(actor: Actor, id: string, reason: string): Promise<void> {
      get(id);
      sessions.reset(id, reason);
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.reset_session', 'agent', id, { reason });
    },

    /**
     * Start an out-of-band compaction of this agent's session. Marks the session compacting first —
     * which is what holds the agent's queued wakes (its next message waits) and keeps the dispatcher
     * off it — then lets the CLI summarise in the background and clears the mark when it answers.
     * Returns as soon as the mark is set, never after the compaction itself.
     */
    async compactSession(actor: Actor, id: string): Promise<{ started: boolean; runtime: string }> {
      const agent = get(id);
      if (sessions.compacting(id)) throw new OcError('wrong_status', `${agent.name}'s session is already compacting`);
      const running = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [id]);
      if (running) throw new OcError('wrong_status', `${agent.name} has a turn running; wait for it or cancel first`);
      const session = sessions.active(id);
      if (!session?.sessionRef) throw new OcError('validation', `${agent.name} has no resumable session to compact`);

      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) : null;
      let setting;
      try { setting = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent); }
      catch (e) { throw new OcError('model_unconfigured', `cannot resolve a runtime for ${agent.name}: ${(e as Error).message}`); }
      const adapter = ctx.registries.runtimes.get(setting.runtime);
      if (!adapter?.compactSession) throw new OcError('validation', `runtime ${setting.runtime} cannot compact a session externally`);

      const sessionId = session.id;
      const ref = session.sessionRef;
      const configHome = join(ctx.paths.runtimesHome, setting.runtime);
      const startedAt = nowIso();
      sessions.setCompacting(sessionId, startedAt, null);
      ctx.events.broadcast('session.compaction', 'agent', id, { agentId: id, compacting: true, at: startedAt, origin: 'daemon' });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.compact_session', 'agent', id, { runtime: setting.runtime });
      log.info({ agentId: id, runtime: setting.runtime }, 'session compaction requested');

      void (async () => {
        let ok = false;
        let via: string | undefined;
        let message = 'compaction failed';
        try {
          const result = await adapter.compactSession!({ ref, cwd: agent.homePath, configHome, model: setting.model ?? null, workspaceId: ctx.workspaceId });
          ok = result.ok;
          via = result.via;
          message = result.error?.message ?? (ok ? '' : 'compaction failed');
        } catch (e) {
          message = `compaction threw: ${String(e)}`;
        }
        sessions.setCompacting(sessionId, null, ok ? null : message);
        ctx.events.broadcast('session.compaction', 'agent', id, { agentId: id, compacting: false, ok, error: ok ? null : message, origin: 'daemon' });
        log[ok ? 'info' : 'warn']({ agentId: id, via, error: ok ? undefined : message }, ok ? 'session compacted' : 'session compaction failed');
      })();

      return { started: true, runtime: setting.runtime };
    },

    handoverCommand(id: string): HandoverStartResult {
      const agent = get(id);
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) : null;
      let model: string | null = null;
      try { model = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent).model ?? null; } catch { /* unconfigured; the command still resolves without a --model flag */ }
      const result = buildHandoverCommand(ctx, agent, sessions.active(id), model);
      return result.resumable
        ? { resumable: true, command: result.command, runtime: result.runtime, landingLine: result.landingLine, reason: null }
        : { resumable: false, command: null, runtime: result.runtime, landingLine: null, reason: result.reason };
    },

    async startHandover(actor: Actor, workerId: string): Promise<HandoverStartResult> {
      const agent = get(workerId);
      const running = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [workerId]);
      if (running) throw new OcError('wrong_status', `${agent.name} has a turn running; wait for it or cancel first`);
      const existing = ctx.db.get<{ id: string }>("SELECT id FROM agent_handovers WHERE agent_id = ? AND status = 'active' LIMIT 1", [workerId]);
      if (existing) throw new OcError('wrong_status', `${agent.name}'s session is already held`);

      const result = service.handoverCommand(workerId);
      if (!result.resumable) throw new OcError('validation', result.reason ?? `${agent.name}'s runtime cannot resume a session outside the daemon`);

      const project = agent.projectId ? projectOf(agent.projectId) : null;
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) : null;
      const wt = agent.worktreePath && existsSync(agent.worktreePath)
        ? await worktreeState(agent.worktreePath, project ? landingBranchOf(project, ticket) : 'main')
        : null;
      const session = sessions.active(workerId);
      const configHome = join(ctx.paths.runtimesHome, agent.runtimeId);
      const now = nowIso();
      const id = newId();
      ctx.db.insert('agent_handovers', {
        id, agentId: workerId, ticketId: agent.ticketId, runtimeId: agent.runtimeId,
        sessionRefJson: session?.sessionRef ?? null, worktreeHead: wt?.head ?? null, worktreeBranch: wt?.branch ?? null,
        startedAt: now, startedBy: actor.id ?? actor.kind, status: 'active',
        lastActivitySignal: sessionActivitySignal(configHome), lastActivityAt: now, createdAt: now, updatedAt: now,
      });
      ctx.db.update('agents', workerId, {
        status: 'paused', pauseReason: 'held by a human in their own terminal',
        pauseDetailJson: { family: null, code: HANDOVER_PAUSE_CODE, message: null, resetAt: null, runId: null },
        updatedAt: now,
      });
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.handover_start', 'agent', workerId, { runtime: agent.runtimeId }, agent.ticketId);
      ctx.events.emit('worker.status', 'agent', workerId, { status: 'paused', reason: 'held by a human in their own terminal' });
      log.info({ workerId }, 'worker session handed to a human');
      return result;
    },

    async endHandover(actor: Actor, workerId: string, note: string): Promise<HandoverEndResult> {
      const trimmed = note.trim();
      if (!trimmed) throw new OcError('validation', 'a note describing what happened is required to give a session back');
      const agent = get(workerId);
      const hold = ctx.db.get<{ id: string; worktreeHead: string | null; lastActivitySignal: string | null; startedAt: string; runtimeId: string }>(
        "SELECT * FROM agent_handovers WHERE agent_id = ? AND status = 'active' LIMIT 1", [workerId],
      );
      if (!hold) throw new OcError('wrong_status', `${agent.name}'s session is not currently held`);

      const snapshot: HandoverSnapshot = { worktreeHead: hold.worktreeHead, runtimeId: hold.runtimeId, lastActivitySignal: hold.lastActivitySignal, startedAt: hold.startedAt };
      const reconciliation = await reconcileHandover(ctx, agent, snapshot);
      const now = nowIso();
      ctx.db.update('agent_handovers', hold.id, { status: 'returned', returnedAt: now, note: trimmed, reconciliationJson: reconciliation, updatedAt: now });
      ctx.db.update('agents', workerId, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: now });
      if (agent.ticketId) {
        try { deps().tickets.comment({ kind: 'system', id: null }, agent.ticketId, handoverCommentBody(agent, reconciliation, trimmed, false), 'status', 'trusted'); }
        catch (e) { log.warn({ workerId, err: String(e) }, 'posting the handback comment failed'); }
      }
      // A wake sent while `agents.status = 'paused'` is skipped outright, not left queued (the wake
      // service's own gate 2) — same as an ordinary pause/resume, `endHandover` must raise a fresh
      // wake itself so the worker actually continues, carrying the human's note as context.
      try {
        deps().wake.enqueue(workerId, {
          source: 'system', reason: `session given back: ${trimmed}`.slice(0, 160),
          payload: { handedBack: true, note: trimmed }, idempotencyKey: `handback:${workerId}:${agent.turnEpoch}`, requestedBy: actor,
        });
      } catch (e) { log.error({ workerId, err: String(e) }, 'giving the session back could not queue its next turn'); }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.handover_end', 'agent', workerId, { newCommits: reconciliation.worktree.newCommits, sessionActivityDetected: reconciliation.sessionActivityDetected }, agent.ticketId);
      ctx.events.emit('worker.status', 'agent', workerId, { status: 'active' });
      log.info({ workerId }, 'worker session given back');
      return { note: trimmed, reconciliation };
    },
  };
  return service;
}
