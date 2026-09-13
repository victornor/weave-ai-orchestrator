import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import type { WorktreeProvider } from '@weave-ai/plugin-sdk';
import type { Agent, Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createWorkersService, ticketBranch, branchSlug } from './index.js';
import { createRolesService } from '../roles/index.js';
import { GitWorktreeProvider } from '../worktrees/git.js';
import { git } from '../util/git.js';
import { runState } from '../runs/active.js';
import type { Actor, WorkersService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const CONDUCTOR: Actor = { kind: 'agent', id: 'conductor', runId: 'run-1' };

describe('workers', () => {
  let h: TestHarness;
  let workers: WorkersService;
  let wake: ReturnType<typeof fakeWake>;
  let clonePath: string;

  async function seedRepo(): Promise<void> {
    clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
    mkdirSync(clonePath, { recursive: true });
    await git(['init', '-b', 'main'], clonePath);
    await git(['config', 'user.email', 'test@example.com'], clonePath);
    await git(['config', 'user.name', 'Test'], clonePath);
    writeFileSync(join(clonePath, 'README.md'), '# api\n', 'utf8');
    await git(['add', '.'], clonePath);
    await git(['commit', '-m', 'init'], clonePath);
  }

  function seedTicket(over: Record<string, unknown> = {}): Ticket {
    const id = newId();
    const now = nowIso();
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
      title: 'Add dark mode', description: 'Make it dark.', status: 'todo', priority: 'medium',
      assigneeRoleId: h.roleId, createdByKind: 'agent', createdAt: now, updatedAt: now, ...over,
    });
    return h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [id])!;
  }

  beforeEach(async () => {
    h = makeHarness();
    wake = fakeWake();
    h.services.wake = wake as never;
    h.services.roles = createRolesService(h.ctx, h.deps);
    h.services.tickets = {
      comment: vi.fn(() => ({ id: 'c1' })),
      create: vi.fn(() => seedTicket({ number: 9, identifier: 'TST-9', kind: 'task', title: 'Curate project knowledge (api)' })),
      transition: vi.fn(async () => ({})),
    } as never;
    h.services.runs = { cancel: vi.fn(async () => undefined) } as never;
    h.ctx.registries.worktreeProviders.set('git', new GitWorktreeProvider());
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    workers = createWorkersService(h.ctx, h.deps);
    await seedRepo();
  });
  afterEach(() => h.cleanup());

  it('derives the ticket branch and change name from the identifier and title', () => {
    const t = { identifier: 'TST-42', title: 'Add dark mode to the dashboard!' } as Ticket;
    expect(ticketBranch(t)).toBe('ac/tst-42-add-dark-mode-to-the-dashboard');
    expect(branchSlug('///')).toBe('work');
  });

  it('spawns a worker: home, worktree, ticket binding and the first wake', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(HUMAN, ticket.id);

    expect(worker.status).toBe('active');
    expect(worker.name).toBe('Backend Engineer #1');
    expect(worker.homePath).toBe(join(h.ctx.paths.workers, worker.id));
    expect(worker.worktreePath).toBe(join(worker.homePath, 'work'));
    expect(worker.branch).toBe('ac/tst-1-add-dark-mode');
    expect(existsSync(join(worker.homePath, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'brief.md'))).toBe(true);
    expect(existsSync(join(worker.homePath, 'notes.md'))).toBe(true);
    expect(existsSync(join(worker.worktreePath!, 'README.md'))).toBe(true);
    expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).toContain('TST-1 — Add dark mode');

    const wt = h.db.get<{ branch: string; status: string; provider: string }>('SELECT * FROM worktrees WHERE agent_id = ?', [worker.id])!;
    expect(wt).toMatchObject({ branch: 'ac/tst-1-add-dark-mode', status: 'active', provider: 'git' });

    const bound = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!;
    expect(bound.workerId).toBe(worker.id);
    expect(bound.openspecChangeName).toBe('tst-1-add-dark-mode');

    expect(wake.calls).toHaveLength(1);
    expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'ticket_assigned' }) });
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM agent_sessions WHERE agent_id = ?', [worker.id])!.n).toBe(1);
  });

  describe('startInteractiveSession (VS-101)', () => {
    it('marks an existing ticket interactive and spawns its worker, exactly as spawnForTicket would', async () => {
      const ticket = seedTicket();
      const agent = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      expect(agent.ticketId).toBe(ticket.id);
      expect(agent.worktreePath).toBeTruthy();
      const updated = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!;
      expect(updated.interactiveSession).toBeTruthy();
    });

    it('creates a fresh ticket marked interactive when no ticketId is given', async () => {
      // The harness's ticket fake ignores its input by default (it exists to satisfy spawnCurator's
      // fixed ticket); this test needs the input actually respected, so it swaps in a real insert.
      (h.services.tickets!.create as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_actor: Actor, input: { kind: string; title: string; description?: string; assigneeRoleId?: string; interactiveSession?: boolean }) =>
          seedTicket({
            number: 9, identifier: 'TST-9', kind: input.kind, title: input.title, description: input.description ?? '',
            assigneeRoleId: input.assigneeRoleId, interactiveSession: input.interactiveSession ?? false,
          }),
      );
      const agent = await workers.startInteractiveSession(HUMAN, {
        projectId: h.projectId, roleId: h.roleId, kind: 'task', title: 'Debug the flaky test',
      });
      const ticket = h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId!])!;
      expect(ticket.title).toBe('Debug the flaky test');
      expect(ticket.interactiveSession).toBeTruthy();
      expect(agent.worktreePath).toBeTruthy();
    });

    it('returns the existing worker rather than spawning a second one', async () => {
      const ticket = seedTicket();
      const first = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      const second = await workers.startInteractiveSession(HUMAN, { ticketId: ticket.id });
      expect(second.id).toBe(first.id);
    });
  });

  it('returns the existing worker instead of spawning twice for a ticket', async () => {
    const ticket = seedTicket();
    const a = await workers.spawnForTicket(SYSTEM, ticket.id);
    const b = await workers.spawnForTicket(SYSTEM, ticket.id);
    expect(b.id).toBe(a.id);
  });

  it('still spawns when the role is at its stored maxWorkers and the project has room', async () => {
    h.db.update('roles', h.roleId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    const spawned = await workers.spawnForTicket(SYSTEM, second.id);
    expect(spawned.status).toBe('active');
  });

  it('refuses to spawn when the project is at its worker limit', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('picks a new project limit up on the next spawn, and lowering it never cancels a live worker', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    const first = await workers.spawnForTicket(SYSTEM, seedTicket().id);
    const second = seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' });
    await expect(workers.spawnForTicket(SYSTEM, second.id)).rejects.toMatchObject({ code: 'role_full' });

    h.db.update('projects', h.projectId, { maxWorkers: 2 });
    const spawned = await workers.spawnForTicket(SYSTEM, second.id);
    expect(spawned.status).toBe('active');

    h.db.update('projects', h.projectId, { maxWorkers: 1 });
    for (const w of [first, spawned]) expect(workers.get(w.id).status).toBe('active');
    const third = seedTicket({ number: 3, identifier: 'TST-3', title: 'Third thing' });
    await expect(workers.spawnForTicket(SYSTEM, third.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('spawns a third worker of one role when the project still has a slot, even if that role is at its stored max', async () => {
    h.db.update('projects', h.projectId, { maxWorkers: 3 });
    h.db.update('roles', h.roleId, { maxWorkers: 2 });
    const now = nowIso();
    const otherRoleId = newId();
    h.db.insert('roles', {
      id: otherRoleId, workspaceId: h.workspaceId, projectId: h.projectId, slug: 'frontend', name: 'Frontend Engineer',
      charterSummary: 'Owns the ui.', scopeText: 'Frontend work.', sessionPolicy: 'per_ticket', maxWorkers: 2,
      status: 'active', specRevision: 1, createdBy: 'conductor', createdAt: now, updatedAt: now,
    });

    await workers.spawnForTicket(SYSTEM, seedTicket().id);
    await workers.spawnForTicket(SYSTEM, seedTicket({ number: 2, identifier: 'TST-2', title: 'Second thing' }).id);
    const third = await workers.spawnForTicket(SYSTEM, seedTicket({ number: 3, identifier: 'TST-3', title: 'Third thing' }).id);
    expect(third.status).toBe('active');

    const fourth = seedTicket({ number: 4, identifier: 'TST-4', title: 'Fourth thing' });
    await expect(workers.spawnForTicket(SYSTEM, fourth.id)).rejects.toMatchObject({ code: 'role_full' });
    const otherTicket = seedTicket({ number: 5, identifier: 'TST-5', title: 'Other role', assigneeRoleId: otherRoleId });
    await expect(workers.spawnForTicket(SYSTEM, otherTicket.id)).rejects.toMatchObject({ code: 'role_full' });
  });

  it('rolls back the agent row, the home and the ticket binding when the worktree fails', async () => {
    const failing: WorktreeProvider = {
      id: 'git',
      detect: async () => ({ available: true }),
      create: async () => { throw new Error('disk on fire'); },
      list: async () => [],
      remove: async () => undefined,
    };
    h.ctx.registries.worktreeProviders.set('git', failing);
    const ticket = seedTicket();
    await expect(workers.spawnForTicket(SYSTEM, ticket.id)).rejects.toThrow(/disk on fire/);
    expect(h.db.all("SELECT * FROM agents WHERE kind = 'worker'")).toHaveLength(0);
    expect(h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!.workerId).toBeNull();
    expect(h.db.all('SELECT * FROM worktrees')).toHaveLength(0);
  });

  it('keeps an unlanded worker and marks its worktree dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    writeFileSync(join(worker.worktreePath!, 'wip.txt'), 'not committed', 'utf8');
    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(false);
    expect(result.reason).toMatch(/uncommitted/);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
    expect(h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!.status).toBe('active');
  });

  it('retires a worker whose work landed on the default branch: worktree removed, home archived', async () => {
    h.db.update('projects', h.projectId, { policiesJson: { deliveryMode: 'local-branch' } });
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const wtPath = worker.worktreePath!;
    writeFileSync(join(wtPath, 'dark.css', ), 'body{}', 'utf8');
    await git(['add', '.'], wtPath);
    await git(['commit', '-m', 'feat: dark mode'], wtPath);
    await git(['merge', '--ff-only', worker.branch!], clonePath);

    const result = await workers.retireIfLanded(SYSTEM, worker.id);
    expect(result.retired).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
    expect(existsSync(join(h.ctx.paths.archive, worker.id, 'brief.md'))).toBe(true);
    const after = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!;
    expect(after.status).toBe('retired');
    expect(after.retiredAt).toBeTruthy();
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('removed');
    expect(h.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [ticket.id])!.workerId).toBeNull();
  });

  it('relaunches with a progress note derived from the ticket and worktree', async () => {
    const ticket = seedTicket({ status: 'in_progress' });
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    h.db.insert('ticket_comments', { id: newId(), ticketId: ticket.id, authorKind: 'agent', authorId: worker.id, body: 'working: wrote the plan', kind: 'status', sourceTrust: 'agent', createdAt: nowIso() });
    wake.calls.length = 0;

    const relaunched = await workers.relaunch(HUMAN, worker.id, 'you stopped responding');
    expect(relaunched.briefRevision).toBe(worker.briefRevision + 1);
    const brief = readFileSync(join(worker.homePath, 'brief.md'), 'utf8');
    expect(brief).toContain('you stopped responding');
    expect(brief).toContain('Ticket TST-1 is in_progress');
    expect(brief).toContain('working: wrote the plan');
    expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'system', reason: 'relaunch' }) });
  });

  // VS-56: resume used to flip the column and stop there, so the endpoint, the CLI verb and the web
  // button all did nothing. It has to queue the turn and unblock the ticket.
  describe('resuming a paused worker', () => {
    const parked = async (): Promise<{ ticket: Ticket; worker: Agent }> => {
      const ticket = seedTicket({ status: 'blocked' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'rate_limit: waiting for a human',
        pauseDetailJson: { family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;
      return { ticket, worker };
    };

    it('clears the pause, queues a turn and unblocks the ticket without touching the worktree', async () => {
      const { ticket, worker } = await parked();

      const after = workers.resume(HUMAN, worker.id);

      expect(after).toMatchObject({ status: 'active', pauseReason: null, pauseDetail: null });
      expect(after.worktreePath).toBe(worker.worktreePath);
      expect(after.branch).toBe(worker.branch);
      expect(after.briefRevision).toBe(worker.briefRevision);
      expect(existsSync(worker.worktreePath!)).toBe(true);
      expect(wake.calls.filter((c) => c.agentId === worker.id)).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'system', reason: 'resumed' }) });
      // This ticket was seeded straight into `blocked` with no `blockedFromStatus` recorded (that
      // field is only ever set by `tickets.transition()` itself, VS-118), so `todo` here is the
      // documented fallback for "no prior status known" — not the bug the tests below cover.
      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'todo' }));
    });

    // VS-118: resume used to pick `in_progress` vs `todo` from `ticket.executionRunId`, which
    // `finalize()` always clears before a run can be parked — so it always read `todo` and a
    // parked `change` ticket lost its approval, forcing a full re-approval of an unchanged plan.
    it('restores an approved change ticket to approved, not todo', async () => {
      const ticket = seedTicket({ status: 'blocked', blockedFromStatus: 'approved' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'tooling: waiting for a human',
        pauseDetailJson: { family: 'tooling', code: 'exit_143', message: 'the process was killed', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;

      workers.resume(HUMAN, worker.id);

      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'approved' }));
    });

    it('restores a parked in_progress task ticket to in_progress, not todo', async () => {
      const ticket = seedTicket({ kind: 'task', status: 'blocked', blockedFromStatus: 'in_progress' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, {
        status: 'paused', pauseReason: 'tooling: waiting for a human',
        pauseDetailJson: { family: 'tooling', code: 'exit_143', message: 'the process was killed', resetAt: null, runId: 'r1' },
      });
      wake.calls.length = 0;

      workers.resume(HUMAN, worker.id);

      expect(h.services.tickets!.transition).toHaveBeenCalledWith(HUMAN, ticket.id, expect.objectContaining({ to: 'in_progress' }));
    });

    it('queues nothing for a worker that was not paused', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      expect(workers.resume(HUMAN, worker.id).status).toBe('active');
      expect(wake.calls).toHaveLength(0);
    });

    it('relaunching a worker parked after a failure resumes it instead', async () => {
      const { worker } = await parked();

      const after = await workers.relaunch({ kind: 'agent', id: 'conductor' }, worker.id, 'you look stuck');

      // Resume, not relaunch: the brief is untouched, so the session and its progress stand.
      expect(after.briefRevision).toBe(worker.briefRevision);
      expect(after).toMatchObject({ status: 'active', pauseDetail: null });
      expect(wake.calls[0]!.input).toMatchObject({ source: 'system', reason: 'resumed' });
      expect(readFileSync(join(worker.homePath, 'brief.md'), 'utf8')).not.toContain('you look stuck');
    });

    it('still relaunches a worker that failed without being parked', async () => {
      const ticket = seedTicket({ status: 'in_progress' });
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, { status: 'error', errorText: 'the CLI died' });
      wake.calls.length = 0;

      const after = await workers.relaunch(HUMAN, worker.id, 'try again');
      expect(after.briefRevision).toBe(worker.briefRevision + 1);
      expect(wake.calls[0]!.input).toMatchObject({ source: 'system', reason: 'relaunch' });
    });
  });

  it('messages a worker as a ticket comment plus a conductor_request wake when the caller asks for no live delivery', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    wake.calls.length = 0;
    // This pins the *service's own* default (queued) when a caller omits `live` entirely — not the
    // conductor's `weave_worker_message` tool, which defaults to `live: true` at the tool layer (VS-103)
    // and is covered separately in packages/server/test/mcp.test.ts.
    const outcome = await workers.message({ kind: 'agent', id: 'conductor' }, worker.id, 'use CSS variables');
    expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'use CSS variables', 'relay', 'agent');
    expect(wake.calls[0]!.input).toMatchObject({ source: 'conductor_request' });
    expect(outcome).toMatchObject({ delivery: 'queued' });
  });

  describe('the conductor cannot message an interactive session (VS-101)', () => {
    it('refuses an agent actor', async () => {
      const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
      await expect(workers.message(CONDUCTOR, session.id, 'what are you doing')).rejects.toThrow(/interactive session/);
    });

    it('leaves a human actor unaffected', async () => {
      const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
      const outcome = await workers.message(HUMAN, session.id, 'go ahead');
      expect(outcome).toMatchObject({ delivery: 'queued' });
    });

    it('does not refuse the conductor on an ordinary (non-session) ticket', async () => {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      const outcome = await workers.message(CONDUCTOR, worker.id, 'status?');
      expect(outcome).toMatchObject({ delivery: 'queued' });
    });
  });

  describe('message: mid-turn vs queued delivery (VS-99)', () => {
    function seedRun(worker: Agent, status = 'running'): string {
      const runId = newId();
      h.db.insert('runs', {
        id: runId, workspaceId: h.workspaceId, agentId: worker.id, wakeupIdsJson: [], runtimeId: 'fake',
        status, turnEpoch: 1, cwd: worker.homePath, createdAt: nowIso(),
      });
      return runId;
    }

    it('delivers mid-turn when `live` is asked for and the active run accepts the frame, and never also queues', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      const sent: string[] = [];
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined,
        send: async (text: string) => { sent.push(text); return 'delivered'; },
      });

      const outcome = await workers.message(HUMAN, worker.id, 'check the failing test', { live: true });
      expect(outcome).toEqual({ delivery: 'mid_turn', runId, wake: null });
      expect(sent).toEqual(['check the failing test']);
      expect(wake.calls).toHaveLength(0); // never both delivered and queued

      const events = h.db.all<{ type: string; payload: Record<string, unknown> }>('SELECT type, payload_json FROM run_events WHERE run_id = ?', [runId]);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('human.input');
      expect(events[0]!.payload).toMatchObject({ text: 'check the failing test', authorKind: 'human', authorId: 'victor', delivery: 'mid_turn' });
    });

    it('queues when `live` is not asked for, even though the runtime could take it mid-turn', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'delivered',
      });

      const outcome = await workers.message(HUMAN, worker.id, 'later is fine');
      expect(outcome.delivery).toBe('queued');
      expect(outcome.wake).not.toBeNull();
      expect(wake.calls).toHaveLength(1);
    });

    it("a human's live message interrupts a running turn on a runtime with no `send` (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });

      const outcome = await workers.message(HUMAN, worker.id, 'stop, wrong direction', { live: true });
      expect(outcome.delivery).toBe('interrupted');
      expect(outcome.runId).toBe(runId);
      expect(outcome.wake).not.toBeNull();
      expect(h.services.runs!.cancel).toHaveBeenCalledWith(HUMAN, runId, 'interrupt', 'message');
      expect(wake.calls).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ agentId: worker.id, input: expect.objectContaining({ source: 'live_interrupt' }) });

      const events = h.db.all<{ payload: Record<string, unknown> }>('SELECT payload_json FROM run_events WHERE run_id = ?', [runId]);
      expect(events[0]!.payload).toMatchObject({ delivery: 'interrupted' });
    });

    it("does not interrupt a live message on the conductor's behalf — only a human's send can (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });

      const outcome = await workers.message(CONDUCTOR, worker.id, 'also, when you get a chance', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(outcome.wake).not.toBeNull();
      expect(h.services.runs!.cancel).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(1);
      expect(wake.calls[0]).toMatchObject({ input: expect.objectContaining({ source: 'conductor_request' }) });
    });

    it('a live message queues, not interrupts, when the runtime has no `send` and no turn is running', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;

      const outcome = await workers.message(HUMAN, worker.id, 'no turn to interrupt', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.runs!.cancel).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(1);
    });

    it("bounds a live-interrupt message's wake body at 8,000 chars, marking the cut (VS-254)", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, { runId, agentId: worker.id, startedAt: Date.now(), pid: 1, cancel: async () => undefined });
      const longBody = 'x'.repeat(8500);

      const outcome = await workers.message(HUMAN, worker.id, longBody, { live: true });
      expect(outcome.delivery).toBe('interrupted');
      const call = wake.calls[0]!;
      const input = call.input as { reason: string; payload: Record<string, unknown> };
      expect(input.payload).toMatchObject({ truncated: true, bodyLength: 8500, message: 'x'.repeat(8000) });
      expect(input.reason).toContain('truncated; full message via weave_ticket_comments');
      // The full, untruncated body is still on the ticket regardless of the wake's bound.
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, longBody, 'relay', 'trusted');
    });

    it("queues when `send` reports the channel is closed — the turn's result already arrived", async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'closed',
      });

      const outcome = await workers.message(HUMAN, worker.id, 'too late', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(wake.calls).toHaveLength(1);
    });

    it('the ticket comment is recorded even when `send` throws', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => { throw new Error('pipe is gone'); },
      });

      const outcome = await workers.message(HUMAN, worker.id, 'are you still there', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'are you still there', 'relay', 'trusted');
      expect(wake.calls).toHaveLength(1);
    });

    it('a mid-turn message leaves an open decision open and touches no permission or tool config', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined, send: async () => 'delivered',
      });
      const decisionId = newId();
      h.db.insert('decisions', {
        id: decisionId, workspaceId: h.workspaceId, ticketId: ticket.id, kind: 'question', owner: 'human',
        title: 'Which approach?', context: '', status: 'open', createdAt: nowIso(),
      });
      const roleBefore = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);

      await workers.message(HUMAN, worker.id, 'go with option A', { live: true });

      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [decisionId])!.status).toBe('open');
      const roleAfter = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);
      expect(roleAfter).toEqual(roleBefore);
    });

    it('a mid-turn message from the conductor leaves an open decision open and touches no permission or tool config (VS-103)', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;
      const runId = seedRun(worker);
      const sent: string[] = [];
      runState(h.ctx).active.set(runId, {
        runId, agentId: worker.id, startedAt: Date.now(), pid: 1,
        cancel: async () => undefined,
        send: async (text: string) => { sent.push(text); return 'delivered'; },
      });
      const decisionId = newId();
      h.db.insert('decisions', {
        id: decisionId, workspaceId: h.workspaceId, ticketId: ticket.id, kind: 'question', owner: 'human',
        title: 'Which approach?', context: '', status: 'open', createdAt: nowIso(),
      });
      const roleBefore = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);

      const outcome = await workers.message(CONDUCTOR, worker.id, 'scope changed, drop the CSV export', { live: true });

      expect(outcome).toMatchObject({ delivery: 'mid_turn' });
      expect(sent).toEqual(['scope changed, drop the CSV export']);
      expect(wake.calls).toHaveLength(0);
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'scope changed, drop the CSV export', 'relay', 'agent');
      expect(h.db.get<{ status: string }>('SELECT status FROM decisions WHERE id = ?', [decisionId])!.status).toBe('open');
      const roleAfter = h.db.get<{ permissionJson: string }>('SELECT permission_json FROM roles WHERE id = ?', [h.roleId]);
      expect(roleAfter).toEqual(roleBefore);
    });
  });

  describe('message: refuses a retired worker (VS-106)', () => {
    it('throws wrong_status and records no comment and no wake', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      h.db.update('agents', worker.id, { status: 'retired', updatedAt: nowIso() });
      wake.calls.length = 0;
      vi.mocked(h.services.tickets!.comment).mockClear();

      await expect(workers.message(HUMAN, worker.id, 'are you still there', { live: true }))
        .rejects.toMatchObject({ code: 'wrong_status' });
      expect(h.services.tickets!.comment).not.toHaveBeenCalled();
      expect(wake.calls).toHaveLength(0);
    });

    it('a non-retired worker is unaffected', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      wake.calls.length = 0;

      const outcome = await workers.message(HUMAN, worker.id, 'still here', { live: true });
      expect(outcome.delivery).toBe('queued');
      expect(h.services.tickets!.comment).toHaveBeenCalledWith(expect.anything(), ticket.id, 'still here', 'relay', 'trusted');
    });
  });

  describe('sessionResumable (VS-106)', () => {
    it('is true for a worker with an active session and false once it is closed', async () => {
      const ticket = seedTicket();
      const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
      expect(workers.sessionResumable(worker.id)).toBe(true);

      h.db.run("UPDATE agent_sessions SET status = 'closed' WHERE agent_id = ?", [worker.id]);
      expect(workers.sessionResumable(worker.id)).toBe(false);
    });
  });

  it('cancel keeps the worktree and marks it dirty', async () => {
    const ticket = seedTicket();
    const worker = await workers.spawnForTicket(SYSTEM, ticket.id);
    const after = await workers.cancel(HUMAN, worker.id, 'no longer needed');
    expect(after.status).toBe('done');
    expect(existsSync(worker.worktreePath!)).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [worker.id])!.status).toBe('dirty');
  });

  it('ending an interactive session is exactly cancel: ticket commented, worktree kept, no new mechanism (VS-101)', async () => {
    const session = await workers.startInteractiveSession(HUMAN, { ticketId: seedTicket().id });
    const after = await workers.cancel(HUMAN, session.id, 'done for now');
    expect(after.status).toBe('done');
    expect(existsSync(session.worktreePath!)).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM worktrees WHERE agent_id = ?', [session.id])!.status).toBe('dirty');
    expect(h.services.tickets!.comment).toHaveBeenCalledWith(
      expect.anything(), session.ticketId, expect.stringContaining('kept until the work lands or is discarded'), 'status', 'trusted',
    );
  });

  it('spawns a curator with no worktree', async () => {
    const curator = await workers.spawnCurator(SYSTEM, h.projectId);
    expect(curator.worktreePath).toBeNull();
    expect(curator.spawnReason).toBe('knowledge curation');
    expect(existsSync(join(curator.homePath, 'AGENTS.md'))).toBe(true);
  });

  it('ensureConductor is idempotent and renders the weaver home', async () => {
    const a = await workers.ensureConductor();
    const b = await workers.ensureConductor();
    expect(b.id).toBe(a.id);
    expect(a.kind).toBe('weaver');
    expect(a.name).toBe('Weaver');
    expect(readFileSync(join(h.ctx.paths.weaver, 'AGENTS.md'), 'utf8')).toContain('weaver');
  });

  it('pauses and resumes a worker', async () => {
    const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
    expect(workers.pause(HUMAN, worker.id, 'lunch').status).toBe('paused');
    expect(workers.resume(HUMAN, worker.id).status).toBe('active');
  });

  describe('session handover (VS-249)', () => {
    async function spawnWithSession(): Promise<import('@weave-ai/shared').Agent> {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      h.db.run("UPDATE agent_sessions SET session_ref_json = ? WHERE agent_id = ?", [JSON.stringify({ sessionId: 'sess-1' }), worker.id]);
      return worker;
    }

    it('handoverCommand says why when the runtime has no session yet', async () => {
      const worker = await workers.spawnForTicket(SYSTEM, seedTicket().id);
      const result = workers.handoverCommand(worker.id);
      expect(result.resumable).toBe(false);
      expect(result.reason).toMatch(/no session/i);
    });

    it('startHandover pauses the worker, opens a hold, and returns a command', async () => {
      const worker = await spawnWithSession();
      const result = await workers.startHandover(HUMAN, worker.id);
      expect(result.resumable).toBe(true);
      expect(result.command).toContain('--resume');
      expect(result.command).toContain('sess-1');

      const after = workers.get(worker.id);
      expect(after.status).toBe('paused');
      expect(after.pauseDetail).toMatchObject({ code: 'held_by_human' });

      const hold = h.db.get<{ status: string; agentId: string }>("SELECT * FROM agent_handovers WHERE agent_id = ? AND status = 'active'", [worker.id]);
      expect(hold).toBeTruthy();
    });

    it('refuses to take a worker with a turn currently running', async () => {
      const worker = await spawnWithSession();
      h.db.insert('runs', { id: 'run-x', workspaceId: h.workspaceId, agentId: worker.id, runtimeId: 'claude', status: 'running', turnEpoch: 1, cwd: worker.homePath, createdAt: nowIso() });
      await expect(workers.startHandover(HUMAN, worker.id)).rejects.toThrow(/running/i);
    });

    it('refuses to take a worker whose session is already held', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      await expect(workers.startHandover(HUMAN, worker.id)).rejects.toThrow(/already held/i);
    });

    it('plain resume refuses a worker whose session is held', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      expect(() => workers.resume(HUMAN, worker.id)).toThrow(/held by a human/i);
      // The hold itself is unaffected by the refused resume attempt.
      const hold = h.db.get<{ status: string }>("SELECT status FROM agent_handovers WHERE agent_id = ? AND status = 'active'", [worker.id]);
      expect(hold?.status).toBe('active');
    });

    it('endHandover rejects an empty or missing note without changing state', async () => {
      const worker = await spawnWithSession();
      await workers.startHandover(HUMAN, worker.id);
      await expect(workers.endHandover(HUMAN, worker.id, '')).rejects.toThrow(/note/i);
      await expect(workers.endHandover(HUMAN, worker.id, '   ')).rejects.toThrow(/note/i);
      expect(workers.get(worker.id).status).toBe('paused');
    });

    it('endHandover reconciles the worktree, posts a ticket comment, and resumes ordinary dispatch', async () => {
      const worker = await spawnWithSession();
      const started = await workers.startHandover(HUMAN, worker.id);
      expect(started.resumable).toBe(true);

      writeFileSync(join(worker.worktreePath!, 'device-notes.txt'), 'usb trace attached\n');
      await git(['add', '.'], worker.worktreePath!);
      await git(['commit', '-m', 'debug notes'], worker.worktreePath!);

      const result = await workers.endHandover(HUMAN, worker.id, 'attached Frida to the device and poked around');
      expect(result.reconciliation.worktree.newCommits).toBe(1);
      expect(result.note).toBe('attached Frida to the device and poked around');

      const after = workers.get(worker.id);
      expect(after.status).toBe('active');
      expect(after.pauseDetail).toBeNull();

      const hold = h.db.get<{ status: string; note: string }>("SELECT status, note FROM agent_handovers WHERE agent_id = ?", [worker.id]);
      expect(hold).toMatchObject({ status: 'returned', note: 'attached Frida to the device and poked around' });

      expect(h.services.tickets!.comment).toHaveBeenCalledWith(
        expect.anything(), worker.ticketId, expect.stringContaining('new commit'), 'status', 'trusted',
      );
    });

    it('endHandover refuses a worker with no open hold', async () => {
      const worker = await spawnWithSession();
      await expect(workers.endHandover(HUMAN, worker.id, 'note')).rejects.toThrow(/not currently held/i);
    });
  });
});
