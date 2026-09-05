import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, TICKET_KINDS, TICKET_STATUSES, canTransition, type TicketKind, type TicketStatus } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import type { Actor, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };
const HUMAN: Actor = { kind: 'human', id: 'victor' };
const SYSTEM: Actor = { kind: 'system', id: null };

describe('tickets', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let wake: ReturnType<typeof fakeWake>;
  let decisions: { create: ReturnType<typeof vi.fn>; supersedeForTarget: ReturnType<typeof vi.fn> };
  let openspec: { validateForProposed: ReturnType<typeof vi.fn>; archiveAfterMerge: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0) };
    openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: '2026-09-04-tst-1-thing', skipped: null })),
    };
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.openspec = openspec as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  afterEach(() => h.cleanup());

  const make = (over: Partial<Parameters<TicketsService['create']>[1]> = {}) =>
    tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  it('allocates sequential identifiers from the workspace counter', () => {
    const a = make();
    const b = make({ title: 'Second' });
    expect(a.identifier).toBe('TST-1');
    expect(b.identifier).toBe('TST-2');
    expect(tickets.nextIdentifier()).toBe('TST-3');
  });

  it('creates assigned tickets in todo and unassigned ones in backlog', () => {
    expect(make().status).toBe('todo');
    expect(make({ assigneeRoleId: null }).status).toBe('backlog');
  });

  it('records the run that created the ticket, and nothing when there is no run', () => {
    expect(tickets.create(AGENT, { kind: 'change', title: 'From a turn', projectId: h.projectId, assigneeRoleId: h.roleId }).createdRunId).toBe('run-1');
    expect(make().createdRunId).toBeNull();
    expect(tickets.create(SYSTEM, { kind: 'task', title: 'From the system', projectId: h.projectId }).createdRunId).toBeNull();
  });

  it('keeps the creating run unchanged as the ticket moves', async () => {
    const t = tickets.create(AGENT, { kind: 'task', title: 'Anchored', projectId: h.projectId });
    tickets.assign(HUMAN, t.id, h.roleId);
    await tickets.transition(SYSTEM, t.id, { to: 'in_progress' });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
    await tickets.transition(AGENT, t.id, { to: 'in_review' });
    await tickets.transition(HUMAN, t.id, { to: 'done' });
    expect(tickets.get(t.id).createdRunId).toBe('run-1');
  });

  it('binds an OpenSpec change name for change tickets in openspec projects', () => {
    expect(make().openspecChangeName).toBe('tst-1-add-dark-mode');
    expect(make({ kind: 'scout', title: 'Investigate' }).openspecChangeName).toBeNull();
  });

  it('rejects blocker cycles', () => {
    const a = make();
    const b = make({ title: 'B' });
    tickets.setBlockers(HUMAN, b.id, [a.id]);
    expect(() => tickets.setBlockers(HUMAN, a.id, [b.id])).toThrow(/cycle/);
  });

  describe('state machine', () => {
    it('matches the shared transition table exactly when every guard is satisfied', async () => {
      for (const kind of TICKET_KINDS) {
        for (const from of TICKET_STATUSES) {
          for (const to of TICKET_STATUSES) {
            if (from === to) continue;
            const t = make({ kind: kind as TicketKind, title: `${kind} ${from}->${to}` });
            const blocker = make({ title: 'blocker' });
            // Satisfy every guard: an open blocker, an unblock path, a work product and auto-merge.
            tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
            h.db.update('tickets', t.id, { status: from, autoMerge: 1 });
            const allowed = canTransition(kind as TicketKind, from as TicketStatus, to as TicketStatus);
            let ok = true;
            let err: unknown;
            try {
              // Reopening a finished ticket is a human's call (PLAN §6.2); everything else the machine may do.
              await tickets.transition(from === 'done' || from === 'cancelled' ? HUMAN : SYSTEM, t.id, {
                to: to as TicketStatus,
                blockedBy: [blocker.id],
                unblock: { owner: 'human', action: 'decide' },
              });
            } catch (e) {
              ok = false;
              err = e;
            }
            expect(ok, `${kind}: ${from} -> ${to} expected ${allowed ? 'allowed' : 'rejected'} (${String(err)})`).toBe(allowed);
            if (ok) expect(tickets.get(t.id).status).toBe(to);
          }
        }
      }
    });

    it('rejects blocked without a routable action path', async () => {
      const t = make();
      await expect(tickets.transition(AGENT, t.id, { to: 'blocked', note: 'stuck' })).rejects.toMatchObject({ code: 'missing_action_path' });
    });

    it('accepts blocked when an open decision exists', async () => {
      const t = make();
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'question', owner: 'human', title: 'Which db?',
        context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
      });
      expect((await tickets.transition(AGENT, t.id, { to: 'blocked' })).status).toBe('blocked');
    });

    it('rejects in_review without a work product', async () => {
      const t = make({ kind: 'task' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await expect(tickets.transition(AGENT, t.id, { to: 'in_review' })).rejects.toMatchObject({ code: 'invalid_disposition' });
    });

    it('rejects merging without an approved merge decision', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_review' });
      await expect(tickets.transition(AGENT, t.id, { to: 'merging' })).rejects.toMatchObject({ code: 'merge_not_approved' });
    });

    it('allows merging once a merge_approval was answered approve', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_review' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'merge_approval', owner: 'human', title: 'Merge?',
        context: '', optionsJson: [], allowFreeText: 1, status: 'answered', answerKey: 'approve', createdAt: nowIso(),
      });
      const workerId = h.addWorker(t.id);
      expect((await tickets.transition(HUMAN, t.id, { to: 'merging' })).status).toBe('merging');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'merge_approved')).toBe(true);
    });
  });

  describe('the proposed gate', () => {
    it('validates with openspec, writes the plan document and opens a plan_approval', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposing' });
      const next = await tickets.transition(AGENT, t.id, { to: 'proposed' });
      expect(next.status).toBe('proposed');
      expect(openspec.validateForProposed).toHaveBeenCalledWith(t.id);
      expect(tickets.getDocument(t.id, 'plan')?.body).toContain('## Proposal');
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'plan_approval', owner: 'human' }));
    });

    it('rejects the transition when openspec validation fails', async () => {
      openspec.validateForProposed.mockResolvedValueOnce({ ok: false, issues: [{ level: 'error', message: 'no tasks' }] });
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposing' });
      await expect(tickets.transition(AGENT, t.id, { to: 'proposed' })).rejects.toMatchObject({ code: 'openspec_validation_failed' });
      expect(tickets.get(t.id).status).toBe('proposing');
    });

    it('auto-approves when the project policy is none', async () => {
      h.db.update('projects', h.projectId, { policiesJson: { proposalApproval: 'none' } });
      const t = make();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposing' });
      const next = await tickets.transition(AGENT, t.id, { to: 'proposed' });
      expect(next.status).toBe('approved');
      expect(decisions.create).not.toHaveBeenCalled();
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('supersedes an open plan approval when a newer plan revision is written', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'plan', 'v1');
      tickets.putDocument(AGENT, t.id, 'plan', 'v2');
      expect(decisions.supersedeForTarget).toHaveBeenCalledWith(expect.anything(), t.id, `plan_approval:${t.id}`);
      expect(tickets.getDocument(t.id, 'plan')?.revision).toBe(2);
      expect(tickets.getDocument(t.id, 'plan', 1)?.body).toBe('v1');
    });

    it('opens a merge_approval on in_review unless auto_merge is set', async () => {
      const t = make({ kind: 'task' });
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'in_review' });
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'merge_approval' }));

      decisions.create.mockClear();
      const auto = make({ kind: 'task', autoMerge: true, title: 'auto' });
      tickets.addWorkProduct(AGENT, auto.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', auto.id, { status: 'in_progress' });
      await tickets.transition(AGENT, auto.id, { to: 'in_review' });
      expect(decisions.create).not.toHaveBeenCalled();
    });
  });

  describe('checkout', () => {
    it('is idempotent for the bound worker and conflicts for anyone else', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.checkout(AGENT, t.id, 'run-1', workerId);
      expect(tickets.get(t.id).checkoutRunId).toBe('run-1');
      expect(tickets.checkout(AGENT, t.id, 'run-2', workerId).executionRunId).toBe('run-2');
      expect(() => tickets.checkout(AGENT, t.id, 'run-3', 'some-other-agent')).toThrow(OcError);
      try {
        tickets.checkout(AGENT, t.id, 'run-3', 'some-other-agent');
      } catch (e) {
        expect((e as OcError).code).toBe('conflict');
      }
    });

    it('conflicts when another agent holds the execution lock on an unbound ticket', () => {
      const t = make({ assigneeRoleId: null });
      const other = h.addWorker(null);
      h.db.insert('runs', {
        id: 'run-other', workspaceId: h.workspaceId, agentId: other, ticketId: t.id, runtimeId: 'claude',
        status: 'running', turnEpoch: 1, cwd: '/tmp', createdAt: nowIso(),
      });
      h.db.update('tickets', t.id, { executionRunId: 'run-other' });
      expect(() => tickets.checkout(AGENT, t.id, 'run-mine', 'agent-mine')).toThrow(/locked by run/);
    });

    it('releases only its own run lock', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.checkout(AGENT, t.id, 'run-1', workerId);
      tickets.release(AGENT, t.id, 'run-other');
      expect(tickets.get(t.id).executionRunId).toBe('run-1');
      tickets.release(AGENT, t.id, 'run-1', 'done for now');
      expect(tickets.get(t.id).executionRunId).toBeNull();
      expect(tickets.get(t.id).checkoutRunId).toBeNull();
    });
  });

  describe('comments and propagation', () => {
    it('wakes the worker on a human comment but not on an agent comment', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      tickets.comment(AGENT, t.id, 'working on it', 'status');
      expect(wake.calls).toHaveLength(0);
      tickets.comment(HUMAN, t.id, 'please also add tests');
      expect(wake.calls).toEqual([expect.objectContaining({ agentId: workerId, input: expect.objectContaining({ source: 'ticket_comment' }) })]);
      expect(tickets.comments(t.id)).toHaveLength(2);
    });

    it('moves a blocked dependent back to todo and wakes it when its blockers land', async () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id).status).toBe('blocked');
      const depWorker = h.addWorker(dep.id);
      h.db.update('tickets', blocker.id, { status: 'in_progress' });
      await tickets.transition(AGENT, blocker.id, { to: 'in_review' }).catch(() => undefined);
      tickets.addWorkProduct(AGENT, blocker.id, { type: 'branch', title: 'ac/x' });
      h.db.update('tickets', blocker.id, { status: 'merging', autoMerge: 1 });
      await tickets.transition(SYSTEM, blocker.id, { to: 'done' });
      expect(tickets.get(dep.id).status).toBe('todo');
      expect(wake.calls.some((c) => c.agentId === depWorker && c.input.source === 'blockers_resolved')).toBe(true);
    });

    it('wakes the parent when every child is terminal', async () => {
      const parent = make({ title: 'parent' });
      const parentWorker = h.addWorker(parent.id);
      const child = make({ title: 'child', parentId: parent.id });
      tickets.cancel(HUMAN, child.id, 'not needed');
      expect(wake.calls.some((c) => c.agentId === parentWorker && c.input.source === 'children_completed')).toBe(true);
    });
  });

  describe('mergeDone', () => {
    it('archives the openspec change and completes the ticket', async () => {
      const t = make();
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'merging' });
      const next = await tickets.mergeDone(AGENT, t.id, { mergeCommit: 'abc1234', method: 'squash' });
      expect(openspec.archiveAfterMerge).toHaveBeenCalledWith(t.id);
      expect(next.status).toBe('done');
      expect(next.delivery).toMatchObject({ merged: true, archivedAs: '2026-09-04-tst-1-thing' });
      expect(h.events.some((e) => e.type === 'ticket.merged')).toBe(true);
    });

    it('leaves the ticket merging with an unblock path when the archive fails', async () => {
      openspec.archiveAfterMerge.mockRejectedValueOnce(new Error('git push denied'));
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await expect(tickets.mergeDone(AGENT, t.id, {})).rejects.toThrow(/archive failed/);
      const after = tickets.get(t.id);
      expect(after.status).toBe('merging');
      expect(after.unblock).toMatchObject({ owner: 'conductor' });
      expect(wake.calls.some((c) => c.agentId === h.conductorId && c.input.source === 'system')).toBe(true);
    });

    it('refuses when the ticket is not merging', async () => {
      const t = make();
      await expect(tickets.mergeDone(AGENT, t.id, {})).rejects.toMatchObject({ code: 'wrong_status' });
    });
  });

  describe('livenessViolations', () => {
    it('ignores tickets with a pending spawn, an open decision or a queued wake', () => {
      const pendingSpawn = make({ title: 'waiting for a slot' });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(pendingSpawn.id);

      const stalled = make({ title: 'stalled' });
      const workerId = h.addWorker(stalled.id);
      h.db.update('tickets', stalled.id, { status: 'in_progress' });
      expect(tickets.livenessViolations().map((t) => t.id)).toContain(stalled.id);

      h.db.insert('wakeups', {
        id: newId(), workspaceId: h.workspaceId, agentId: workerId, source: 'system', reason: 'ping',
        payloadJson: {}, status: 'queued', createdAt: nowIso(),
      });
      expect(tickets.livenessViolations().map((t) => t.id)).not.toContain(stalled.id);
    });
  });

  it('lists and filters tickets', () => {
    make({ title: 'one' });
    const two = make({ title: 'two', kind: 'scout' });
    tickets.cancel(HUMAN, two.id, 'nope');
    expect(tickets.list().total).toBe(1);
    expect(tickets.list({ includeTerminal: true }).total).toBe(2);
    expect(tickets.list({ kind: ['scout'], includeTerminal: true }).items[0]?.id).toBe(two.id);
    expect(tickets.list({ search: 'one' }).total).toBe(1);
  });
});
