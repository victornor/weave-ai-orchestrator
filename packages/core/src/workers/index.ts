import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import {
  HANDOVER_PAUSE_CODE, OcError, heldByHuman, landingBranchOf, projectLabel, waitingOnRuntimeLogin, type Agent, type Project, type Role, type Ticket, type TicketStatus,
} from '@weave-ai/shared';
import type { WorktreeProvider } from '@weave-ai/plugin-sdk';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, HandoverEndResult, HandoverStartResult, WorkerMessageOutcome, WorkersService } from '../api.js';
import { recordActivity } from '../events.js';
import { recordHumanInputEvent, runState } from '../runs/active.js';
import { renderHome } from './home.js';
import { renderBrief } from '../prompts/index.js';
import { createSessions } from '../sessions/index.js';
import { modelSettingFor, modelsFor } from '../models/resolve.js';
import { landedWorkTest } from '../worktrees/landed.js';
import { git, worktreeState } from '../util/git.js';
import { buildHandoverCommand } from './resume-command.js';
import { sessionActivitySignal } from './activity-signal.js';
import { handoverCommentBody, reconcileHandover, type HandoverSnapshot } from './handover-reconcile.js';

export { renderHome, ensureHomeCurrent, skillsFor } from './home.js';

const LIVE = "('provisioning','active','running','paused','error')";

/**
 * Same bound as threads' `HUMAN_MESSAGE_WAKE_BODY_CHARS` and tickets' `TICKET_COMMENT_WAKE_BODY_CHARS`
 * (VS-242/VS-246): a human's own words flowing into a stored wake payload and a rendered prompt line
 * get the same treatment everywhere, not a fourth number.
 */
const LIVE_INTERRUPT_WAKE_BODY_CHARS = 8000;

function liveInterruptWakeBody(body: string): { body: string; truncated?: true; bodyLength?: number } {
  if (body.length <= LIVE_INTERRUPT_WAKE_BODY_CHARS) return { body };
  return { body: body.slice(0, LIVE_INTERRUPT_WAKE_BODY_CHARS), truncated: true, bodyLength: body.length };
}

export function branchSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'work';
}

/** `ac/<identifier-lowercase>-<slug>` (PLAN §11.2); the OpenSpec change name is the same without the prefix. */
export function ticketBranch(ticket: Ticket): string { return `ac/${ticket.identifier.toLowerCase()}-${branchSlug(ticket.title)}`; }
export function openspecChangeName(ticket: Ticket): string { return `${ticket.identifier.toLowerCase()}-${branchSlug(ticket.title)}`; }

export function createWorkersService(ctx: WorkspaceContext, deps: () => CoreServices): WorkersService {
  const log = ctx.log('daemon');
  const sessions = createSessions(ctx);

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

  async function spawn(actor: Actor, ticketId: string, opts: { noWorktree?: boolean; spawnReason?: string } = {}): Promise<Agent> {
    const ticket = ticketOf(ticketId);
    const existing = ctx.db.get<Agent>(`SELECT * FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status IN ${LIVE}`, [ticket.id]);
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
        const provider = providerFor(project);
        const targetPath = join(home, 'work');
        const info = await provider.create({
          repoPath: project.clonePath, branch, base: landingBranchOf(project, ticket), targetPath,
          setupCommand: project.setupCommand ?? undefined, warmPaths: (project as unknown as { warmPaths?: string[] }).warmPaths ?? [],
          configPath: ctx.paths.wtConfig,
        });
        worktreeRowId = newId();
        ctx.db.insert('worktrees', {
          id: worktreeRowId, projectId: project.id, ticketId: ticket.id, agentId: id, provider: provider.id,
          path: info.path, branch: info.branch || branch, status: 'active', createdAt: now, lastVerifiedAt: now,
        });
        ctx.db.update('agents', id, { worktreePath: info.path, branch: info.branch || branch, updatedAt: nowIso() });
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
      sessions.forTurn({ id, kind: 'worker', runtimeId: modelSettingFor(modelsFor(ctx), 'worker', ticket).runtime }, role.sessionPolicy);
      deps().wake.enqueue(id, { source: 'ticket_assigned', reason: `${ticket.identifier}: ${ticket.title}`, payload: { ticketId: ticket.id }, requestedBy: actor });
    } catch (e) {
      // Roll back the row, the home and the worktree; nothing half-created is left behind.
      log.error({ err: String(e), ticketId: ticket.id }, 'worker spawn failed; rolling back');
      try {
        if (!opts.noWorktree) {
          const provider = providerFor(project);
          await provider.remove({ repoPath: project.clonePath, path: join(home, 'work'), branch, deleteBranch: true, force: true, configPath: ctx.paths.wtConfig }).catch(() => undefined);
        }
      } catch { /* best effort */ }
      if (worktreeRowId) ctx.db.run('DELETE FROM worktrees WHERE id = ?', [worktreeRowId]);
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
      const where = ["workspace_id = ?", "kind = 'worker'"];
      const params: unknown[] = [ctx.workspaceId];
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
      sessions.forTurn({ id: a.id, kind: 'weaver', runtimeId: a.runtimeId }, 'persistent');
      return get(a.id);
    },

    spawnForTicket(actor: Actor, ticketId: string): Promise<Agent> { return spawn(actor, ticketId); },

    async spawnCurator(actor: Actor, projectId: string): Promise<Agent> {
      const project = projectOf(projectId);
      const role = ctx.db.get<Role>("SELECT * FROM roles WHERE project_id = ? AND status = 'active' ORDER BY created_at LIMIT 1", [projectId]);
      if (!role) throw new OcError('wrong_status', `project ${project.slug} has no active role to curate its knowledge`);
      const ticket = deps().tickets.create(actor, {
        projectId, kind: 'task', title: `Curate project knowledge (${projectLabel(project)})`,
        description: 'Curate this project\'s knowledge base: merge duplicates, fold learnings that became conventions, archive stale entries, keep every section within budget. Never invent facts. Submit with `weave_knowledge_replace`.',
        priority: 'low', assigneeRoleId: role.id, originKind: 'curation', originFingerprint: `curation:${projectId}`,
      });
      return spawn(actor, ticket.id, { noWorktree: true, spawnReason: 'knowledge curation' });
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

    async message(actor: Actor, workerId: string, body: string, opts: { live?: boolean } = {}): Promise<WorkerMessageOutcome> {
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
      deps().tickets.comment(actor, agent.ticketId, body, 'relay', actor.kind === 'human' ? 'trusted' : 'agent');

      let delivery: 'mid_turn' | 'queued' | 'interrupted' = 'queued';
      let runId: string | null = null;
      if (opts.live) {
        for (const active of runState(ctx).active.values()) {
          if (active.agentId !== workerId) continue;
          if (active.send) {
            runId = active.runId;
            try { if ((await active.send(body)) === 'delivered') delivery = 'mid_turn'; }
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
        const wb = liveInterruptWakeBody(body);
        // Naming `weave_ticket_comments` as the full-text pointer is safe here specifically: the
        // `tickets.comment(...)` call above already recorded the untruncated `body` as a ticket
        // comment before any delivery was attempted, regardless of how this send turns out.
        const reason = wb.truncated ? `${wb.body} (truncated; full message via weave_ticket_comments)` : wb.body;
        wake = deps().wake.enqueue(workerId, {
          source: 'live_interrupt', reason,
          payload: { ticketId: agent.ticketId, message: wb.body, ...(wb.truncated ? { truncated: true as const, bodyLength: wb.bodyLength } : {}), interruptedRunId: runId },
          requestedBy: actor,
        });
      } else if (delivery === 'queued') {
        wake = deps().wake.enqueue(workerId, { source: 'conductor_request', reason: body.slice(0, 160), payload: { ticketId: agent.ticketId, message: body }, requestedBy: actor });
      }
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.message', 'agent', workerId, { length: body.length, delivery }, agent.ticketId);
      return { delivery, runId, wake };
    },

    async relaunch(actor: Actor, workerId: string, note: string): Promise<Agent> {
      const agent = get(workerId);
      // A worker parked after a failure is not stuck, it is waiting on a human: relaunching it is a
      // resume (VS-56). Its session, ticket, worktree and brief all stand, so there is nothing to
      // re-render and no progress to re-derive.
      if (agent.status === 'paused' && agent.pauseDetail) return service.resume(actor, workerId);
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) ?? null : null;
      const active = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [workerId]);
      if (active) { try { await deps().runs.cancel(actor, active.id, 'kill'); } catch { /* already gone */ } }
      const derived = await progressNote(agent, ticket);
      const relaunchNote = [note, derived].filter(Boolean).join(' ');
      ctx.db.update('agents', workerId, { briefRevision: agent.briefRevision + 1, status: 'active', errorText: null, updatedAt: nowIso() });
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
      const runtimeId = modelSettingFor(modelsFor(ctx), agent.kind, ticket).runtime;
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

      if (project && wt) {
        const merged = agent.ticketId
          ? ctx.db.get<{ id: string }>("SELECT id FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' AND lower(COALESCE(state,'')) = 'merged' LIMIT 1", [agent.ticketId])
          : undefined;
        const policies = (project.policies ?? {}) as { deliveryMode?: string };
        const verdict = await landedWorkTest({
          repoPath: project.clonePath, worktreePath: wt.path, branch: wt.branch, landingBranch: landingBranchOf(project, ticket),
          mergedPr: !!merged, localBranch: (policies.deliveryMode ?? ctx.config.defaults.deliveryMode) === 'local-branch',
        });
        if (!verdict.landed) {
          ctx.db.update('worktrees', wt.id, { status: 'dirty', lastVerifiedAt: nowIso(), landedEvidenceJson: verdict.evidence });
          log.info({ workerId, reason: verdict.reason }, 'worker not retired: work has not landed');
          return { retired: false, reason: verdict.reason };
        }
        try {
          const provider = providerFor(project);
          await provider.remove({ repoPath: project.clonePath, path: wt.path, branch: wt.branch, deleteBranch: true, force: false, configPath: ctx.paths.wtConfig });
        } catch (e) {
          ctx.db.update('worktrees', wt.id, { status: 'dirty', lastVerifiedAt: nowIso() });
          return { retired: false, reason: `worktree removal failed: ${String(e)}` };
        }
        ctx.db.update('worktrees', wt.id, { status: 'removed', removedAt: nowIso(), lastVerifiedAt: nowIso(), landedEvidenceJson: verdict.evidence });
      }

      // Archive the home (brief, notes, final report); run logs stay under .weave/runs.
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
      recordActivity(ctx.db, ctx.workspaceId, actor, 'worker.retire', 'agent', workerId, {}, agent.ticketId);
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

    handoverCommand(id: string): HandoverStartResult {
      const agent = get(id);
      const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) : null;
      let model: string | null = null;
      try { model = modelSettingFor(modelsFor(ctx), agent.kind, ticket).model ?? null; } catch { /* unconfigured; the command still resolves without a --model flag */ }
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
