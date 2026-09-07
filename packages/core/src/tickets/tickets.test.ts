import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError, TICKET_KINDS, TICKET_STATUSES, NAMED_CARD_OPTION_KEYS, canTransition, type TicketKind, type TicketStatus } from '@agent-conductor/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
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
  let specs: ReturnType<typeof fakeSpecs>;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0) };
    openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: '2026-09-04-tst-1-thing', skipped: null })),
    };
    specs = fakeSpecs();
    h.services.wake = wake as never;
    h.services.decisions = decisions as never;
    h.services.openspec = openspec as never;
    // A merge schedules a spec re-index; without this the harness proxy throws inside that timer.
    h.services.specs = specs as never;
    // The merge queue brings a worker for the ticket it admits (PLAN §11.4).
    h.services.workers = { spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })) } as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  // Drain the follow-up work a merge scheduled before the harness (and its db) goes away.
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

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

  it('stores interactiveSession from the input, defaulting false (VS-101)', () => {
    expect(make().interactiveSession).toBe(false);
    expect(make({ interactiveSession: true }).interactiveSession).toBe(true);
  });

  it('stores landingBranch from the input, defaulting null (VS-119)', () => {
    expect(make().landingBranch).toBeNull();
    expect(make({ landingBranch: 'main' }).landingBranch).toBe('main');
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

    // VS-118: the ticket forgot what it was doing before it was blocked, so resuming or unblocking
    // it always fell back to `todo` — this is what remembers.
    it('records the status a ticket held before it was blocked, and clears it on the way out', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'approved' });
      const blocked = await tickets.transition(SYSTEM, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'decide' } });
      expect(blocked.blockedFromStatus).toBe('approved');

      const restored = await tickets.transition(SYSTEM, t.id, { to: 'approved' });
      expect(restored.blockedFromStatus).toBeNull();
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
      // VS-111: the plan-approval card's buttons are hard-coded to these keys — the decision the
      // daemon actually raises must offer no other keys, or pressing one of them would fail.
      const planCall = decisions.create.mock.calls.find((c) => c[1]?.kind === 'plan_approval');
      expect(planCall?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.plan_approval));
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

    it('supersedes an open plan approval when the daemon writes a newer plan revision', () => {
      // `{ system: true }` simulates transition()'s own internal write — the one legitimate writer.
      const t = make();
      tickets.putDocument(AGENT, t.id, 'plan', 'v1', { system: true });
      tickets.putDocument(AGENT, t.id, 'plan', 'v2', { system: true });
      expect(decisions.supersedeForTarget).toHaveBeenCalledWith(expect.anything(), t.id, `plan_approval:${t.id}`);
      expect(tickets.getDocument(t.id, 'plan')?.revision).toBe(2);
      expect(tickets.getDocument(t.id, 'plan', 1)?.body).toBe('v1');
    });

    it('refuses an external write to the plan key, leaving any open approval untouched', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'plan', 'the daemon digest', { system: true });
      decisions.supersedeForTarget.mockClear();
      expect(() => tickets.putDocument(AGENT, t.id, 'plan', 'my own notes')).toThrow(expect.objectContaining({ code: 'forbidden' }));
      expect(decisions.supersedeForTarget).not.toHaveBeenCalled();
      expect(tickets.getDocument(t.id, 'plan')?.revision).toBe(1);
      expect(tickets.getDocument(t.id, 'plan')?.body).toBe('the daemon digest');
    });

    it('lists the documents on a ticket with their current revision', () => {
      const t = make();
      tickets.putDocument(AGENT, t.id, 'report', 'r1');
      tickets.putDocument(AGENT, t.id, 'report', 'r2');
      tickets.putDocument(AGENT, t.id, 'notes', 'n1');
      expect(tickets.documents(t.id).map((d) => ({ key: d.key, revision: d.revision }))).toEqual([
        { key: 'notes', revision: 1 },
        { key: 'report', revision: 2 },
      ]);
      expect(tickets.documents(t.id)[1]?.updatedAt).not.toBe('');
    });

    it('opens a merge_approval on in_review unless auto_merge is set', async () => {
      const t = make({ kind: 'task' });
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'in_review' });
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'merge_approval' }));
      // VS-111: the merge-approval card no longer offers Hold, so the decision it answers must never
      // offer a third key that a card could be tempted to send.
      const mergeCall = decisions.create.mock.calls.find((c) => c[1]?.kind === 'merge_approval');
      expect(mergeCall?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.merge_approval));

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

    // VS-118: a dependent blocked while `approved` (or further along) used to lose that status to the
    // same `assigneeRoleId ? todo : backlog` guess `setBlockers` and this propagation used for a
    // ticket that never had a recorded prior status. Once one is recorded, it wins.
    it('returns a blocked dependent to the status it held, not always todo, when its blockers land', async () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      h.db.update('tickets', dep.id, { status: 'approved' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id)).toMatchObject({ status: 'blocked', blockedFromStatus: 'approved' });

      tickets.addWorkProduct(AGENT, blocker.id, { type: 'branch', title: 'ac/x' });
      h.db.update('tickets', blocker.id, { status: 'merging', autoMerge: 1 });
      await tickets.transition(SYSTEM, blocker.id, { to: 'done' });

      expect(tickets.get(dep.id)).toMatchObject({ status: 'approved', blockedFromStatus: null });
    });

    it('setBlockers itself restores the status a ticket held before it was blocked', () => {
      const blocker = make({ title: 'blocker' });
      const dep = make({ title: 'dependent' });
      h.db.update('tickets', dep.id, { status: 'in_progress' });
      tickets.setBlockers(HUMAN, dep.id, [blocker.id]);
      expect(tickets.get(dep.id)).toMatchObject({ status: 'blocked', blockedFromStatus: 'in_progress' });

      tickets.setBlockers(HUMAN, dep.id, []);

      expect(tickets.get(dep.id)).toMatchObject({ status: 'in_progress', blockedFromStatus: null });
    });

    it('wakes the parent when every child is terminal', async () => {
      const parent = make({ title: 'parent' });
      const parentWorker = h.addWorker(parent.id);
      const child = make({ title: 'child', parentId: parent.id });
      tickets.cancel(HUMAN, child.id, 'not needed');
      expect(wake.calls.some((c) => c.agentId === parentWorker && c.input.source === 'children_completed')).toBe(true);
    });
  });

  // VS-118: `retry()` picked `in_progress` vs `todo` from `t.executionRunId`, which is always null
  // for a blocked ticket by the time a human retries it — the run that got it parked already cleared
  // its own lock. It must restore what the ticket actually was.
  describe('retry (VS-118)', () => {
    it('restores the ticket to the status it held before it was blocked, not always todo', async () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      const relaunch = vi.fn(async () => undefined);
      h.services.workers = { get: vi.fn(() => ({ id: workerId, status: 'active' })), relaunch } as never;
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(SYSTEM, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'retry or cancel' } });

      const after = await tickets.retry(HUMAN, t.id, 'try again');

      expect(relaunch).toHaveBeenCalledWith(HUMAN, workerId, 'try again');
      expect(after.status).toBe('in_progress');
    });
  });

  describe('lastWorker (VS-106)', () => {
    it('names the ticket\'s worker even after retirement nulls its current one', () => {
      const t = make();
      const workerId = h.addWorker(t.id);
      expect(tickets.lastWorker(t.id)?.id).toBe(workerId);

      h.db.update('agents', workerId, { status: 'retired', retiredAt: nowIso() });
      h.db.update('tickets', t.id, { workerId: null });
      expect(tickets.lastWorker(t.id)?.id).toBe(workerId);
    });

    it('is null for a ticket that never had a worker', () => {
      const t = make();
      expect(tickets.lastWorker(t.id)).toBeNull();
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

  describe('post-merge follow-up work', () => {
    /** Merge `t` and let the scheduled follow-up work fire and settle. */
    const mergeAndDrain = async (t: { id: string }) => {
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      vi.advanceTimersByTime(200);
      await tickets.stop();
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-indexes the merged ticket\'s project', async () => {
      const t = make();
      await mergeAndDrain(t);
      expect(specs.calls).toEqual([h.projectId]);
    });

    it('schedules nothing for a ticket without a project', async () => {
      const t = make({ projectId: null, assigneeRoleId: null });
      await mergeAndDrain(t);
      expect(specs.calls).toEqual([]);
    });

    it('contains a re-index that throws before it returns a promise', async () => {
      // `deps()` throws synchronously for a service the test did not stub, so the throw happens
      // before `index()` is called — the reason this timer used to take the whole run down.
      delete h.services.specs;
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      await expect(tickets.stop()).resolves.toBeUndefined();
      expect(tickets.get(t.id).status).toBe('done');
    });

    it('contains a re-index that rejects, and still runs the next one', async () => {
      specs.index = vi.fn()
        .mockRejectedValueOnce(new Error('index failed'))
        .mockResolvedValueOnce({ capabilities: 0, changes: 0 });
      const first = make();
      const second = make();
      h.db.update('tickets', first.id, { status: 'merging' });
      h.db.update('tickets', second.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, first.id, {});
      await tickets.mergeDone(AGENT, second.id, {});
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      await expect(tickets.stop()).resolves.toBeUndefined();
      expect(specs.index).toHaveBeenCalledTimes(2);
      expect(tickets.get(second.id).status).toBe('done');
    });

    it('cancels work that has not fired yet', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      await tickets.stop();
      vi.advanceTimersByTime(1000);
      expect(specs.calls).toEqual([]);
    });

    it('waits for work already in flight', async () => {
      let release: () => void = () => {};
      let finished = false;
      specs.index = vi.fn(() => new Promise<{ capabilities: number; changes: number }>((resolve) => {
        release = () => { finished = true; resolve({ capabilities: 0, changes: 0 }); };
      })) as never;
      const t = make();
      h.db.update('tickets', t.id, { status: 'merging' });
      await tickets.mergeDone(AGENT, t.id, {});
      vi.advanceTimersByTime(200);
      const stopped = tickets.stop();
      expect(finished).toBe(false);
      release();
      await stopped;
      expect(finished).toBe(true);
    });

    it('resolves when idle and when called twice', async () => {
      await expect(tickets.stop()).resolves.toBeUndefined();
      const t = make();
      await mergeAndDrain(t);
      await expect(tickets.stop()).resolves.toBeUndefined();
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

  describe('repairApprovals', () => {
    it('raises a fresh plan_approval for a proposed ticket with none open, and leaves one with an open approval alone', async () => {
      const stranded = make({ title: 'stranded' });
      h.db.update('tickets', stranded.id, { status: 'proposed' });

      const fine = make({ title: 'fine' });
      h.db.update('tickets', fine.id, { status: 'proposed' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: fine.id, kind: 'plan_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'open', correlationKey: `plan_approval:${fine.id}`, createdAt: nowIso(),
      });
      decisions.create.mockClear();

      const repaired = await tickets.repairApprovals();
      expect(repaired).toEqual([{ id: stranded.id, identifier: stranded.identifier, kind: 'plan_approval' }]);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: stranded.id, kind: 'plan_approval' }));
      // VS-111: repairApprovals re-raises with its own (duplicated) options array — must not drift
      // from the one the normal `proposed` transition creates.
      expect(decisions.create.mock.calls[0]?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.plan_approval));
    });

    it('raises a fresh merge_approval for an in_review, non-auto_merge ticket with none open, and skips auto_merge tickets', async () => {
      const stranded = make({ kind: 'task', title: 'stranded' });
      h.db.update('tickets', stranded.id, { status: 'in_review' });

      const auto = make({ kind: 'task', title: 'auto', autoMerge: true });
      h.db.update('tickets', auto.id, { status: 'in_review' });
      decisions.create.mockClear();

      const repaired = await tickets.repairApprovals();
      expect(repaired).toEqual([{ id: stranded.id, identifier: stranded.identifier, kind: 'merge_approval' }]);
      expect(decisions.create).toHaveBeenCalledTimes(1);
      expect(decisions.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: stranded.id, kind: 'merge_approval' }));
      // VS-111: same duplicated-array risk as the plan_approval repair path above.
      expect(decisions.create.mock.calls[0]?.[1]?.options.map((o: { key: string }) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS.merge_approval));
    });

    it('reports nothing when every waiting ticket already has an open approval', async () => {
      const t = make();
      h.db.update('tickets', t.id, { status: 'proposed' });
      h.db.insert('decisions', {
        id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'plan_approval', owner: 'human',
        title: 'Approve?', context: '', status: 'open', correlationKey: `plan_approval:${t.id}`, createdAt: nowIso(),
      });
      expect(await tickets.repairApprovals()).toEqual([]);
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

  it('orders finished tickets by when they landed, not by ticket number', () => {
    // Filed first but finished last, so number order and finish order disagree.
    const old = make({ title: 'long runner' });
    const fresh = make({ title: 'quick one' });
    const dropped = make({ title: 'dropped' });
    h.db.update('tickets', fresh.id, { status: 'done', completedAt: '2026-09-01T09:00:00.000Z' });
    h.db.update('tickets', dropped.id, { status: 'cancelled', cancelledAt: '2026-09-02T09:00:00.000Z' });
    h.db.update('tickets', old.id, { status: 'done', completedAt: '2026-09-03T09:00:00.000Z' });

    const finished = tickets.list({ status: ['done', 'cancelled'], sort: 'finished' });
    expect(finished.items.map((t) => t.id)).toEqual([old.id, dropped.id, fresh.id]);
    // The default ordering is unchanged: newest ticket number first.
    expect(tickets.list({ status: ['done', 'cancelled'] }).items.map((t) => t.id)).toEqual([dropped.id, fresh.id, old.id]);
  });
});
