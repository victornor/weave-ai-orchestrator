import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@weave-ai/db';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from '../tickets/service.js';
import { createDecisionsService } from './service.js';
import { runState } from '../runs/active.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const AGENT: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };
const SYSTEM: Actor = { kind: 'system', id: null };

describe('decisions', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let decisions: DecisionsService;
  let wake: ReturnType<typeof fakeWake>;
  let knowledge: { appendDecision: ReturnType<typeof vi.fn> };
  let roles: { activate: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    knowledge = { appendDecision: vi.fn() };
    roles = { activate: vi.fn(async () => ({ id: 'role' })), update: vi.fn(async () => ({ role: { id: 'role' }, changedKeys: [], charterRewritten: false, reBriefed: 0 })) };
    h.services.wake = wake as never;
    h.services.knowledge = knowledge as never;
    h.services.roles = roles as never;
    h.services.openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: null })),
    } as never;
    tickets = createTicketsService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    h.services.decisions = decisions;
  });
  afterEach(() => h.cleanup());

  const ticket = (over = {}) => tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  // VS-281: the weaver must now mark a review-carrying decision `looked` before its approving
  // answer is accepted. Tests whose subject is not the review state mark it here, which is also the
  // normal production path.
  const conductor = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' });
  const markLooked = (id: string, note = 'reviewed the work') => decisions.review(conductor(), id, { status: 'looked', note });

  it('keeps one open decision per ticket and correlation key, superseding the older one', async () => {
    const t = ticket();
    const first = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'v1', correlationKey: `plan_approval:${t.id}` });
    const second = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'v2', correlationKey: `plan_approval:${t.id}` });
    expect(decisions.get(first.id).status).toBe('superseded');
    expect(decisions.get(second.id).status).toBe('open');
    await new Promise((r) => setImmediate(r));
    expect(h.events.some((e) => e.type === 'decision.superseded')).toBe(true);
  });

  it('derives the owner from the project policy for plan approvals', () => {
    const t = ticket();
    expect(decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'x' }).owner).toBe('human');
    h.db.update('projects', h.projectId, { policiesJson: { proposalApproval: 'conductor' } });
    const t2 = ticket({ title: 'second' });
    expect(decisions.create(AGENT, { ticketId: t2.id, kind: 'plan_approval', title: 'y' }).owner).toBe('weaver');
    expect(decisions.create(AGENT, { kind: 'gate_finding', title: 'z' }).owner).toBe('weaver');
  });

  it('resolves a worker-asked question or concern to the conductor, and wakes it immediately', () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    for (const kind of ['question', 'concern'] as const) {
      const d = decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: workerId, correlationKey: `${kind}:${newId()}` });
      expect(d.owner).toBe('weaver');
      const w = wake.calls.find((c) => c.agentId === h.conductorId && (c.input.payload as { decisionId?: string })?.decisionId === d.id);
      expect(w).toBeDefined();
    }
  });

  it('resolves a ticketed session\'s question or concern to the conductor, like a worker\'s (VS-495)', () => {
    const t = ticket();
    const sessionId = h.addWorker(t.id, { kind: 'session' });
    for (const kind of ['question', 'concern'] as const) {
      expect(decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: sessionId, correlationKey: `${kind}:${newId()}` }).owner).toBe('weaver');
    }
  });

  it('keeps a ticketless session\'s question or concern owned by the human, like the conductor\'s own (VS-495)', () => {
    const sessionId = h.addWorker(null, { kind: 'session' });
    for (const kind of ['question', 'concern'] as const) {
      expect(decisions.create(AGENT, { kind, title: kind, askedByAgentId: sessionId, correlationKey: `${kind}:${newId()}` }).owner).toBe('human');
    }
  });

  it('keeps a question or concern owned by the human when the conductor itself asks (or nobody is named)', () => {
    const t = ticket();
    for (const kind of ['question', 'concern'] as const) {
      expect(decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: h.conductorId, correlationKey: `${kind}:${newId()}` }).owner).toBe('human');
      expect(decisions.create(AGENT, { ticketId: t.id, kind, title: kind, correlationKey: `${kind}:nobody:${newId()}` }).owner).toBe('human');
    }
  });

  it('keeps gate_finding owned by the conductor regardless of who asks', () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    expect(decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'x', askedByAgentId: workerId, correlationKey: newId() }).owner).toBe('weaver');
    expect(decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'y', askedByAgentId: h.conductorId, correlationKey: newId() }).owner).toBe('weaver');
  });

  // VS-519: the documented escalation flow — the weaver raises its own ask to the human about a
  // worker's ask, then relays the human's answer back onto the worker's decision. Before this change
  // both asks derived `question:<ticketId>`, so the escalation superseded the worker's card and the
  // relay failed with `wrong_status`. The derived bucket is now owner-scoped.
  describe('escalating a worker ask leaves its decision answerable (VS-519)', () => {
    it('a worker question and the conductor escalation coexist', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const worker = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', askedByAgentId: workerId });
      const escalation = decisions.create(conductor(), { ticketId: t.id, kind: 'question', title: 'Which store should the worker use?' });

      expect(worker.owner).toBe('weaver');
      expect(escalation.owner).toBe('human');
      expect(decisions.get(worker.id).status).toBe('open');
      expect(decisions.get(escalation.id).status).toBe('open');
    });

    it('a worker concern and the conductor escalation coexist', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const worker = decisions.create(AGENT, { ticketId: t.id, kind: 'concern', title: 'The stated fix does not close it', askedByAgentId: workerId });
      const escalation = decisions.create(conductor(), { ticketId: t.id, kind: 'concern', title: 'The stated fix does not close it' });

      expect(decisions.get(worker.id).status).toBe('open');
      expect(decisions.get(escalation.id).status).toBe('open');
    });

    it('a worker gate_finding survives an escalation that reaches the human through another kind', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const finding = decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'Spec implies dropping a legacy table', askedByAgentId: workerId });
      const escalation = decisions.create(conductor(), { ticketId: t.id, kind: 'question', title: 'Drop the legacy table?' });

      expect(finding.owner).toBe('weaver');
      expect(escalation.owner).toBe('human');
      expect(decisions.get(finding.id).status).toBe('open');
      expect(decisions.get(escalation.id).status).toBe('open');
    });

    it('relays the human answer onto the worker decision and wakes the worker', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const worker = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', askedByAgentId: workerId });
      const escalation = decisions.create(conductor(), { ticketId: t.id, kind: 'question', title: 'Which store?', options: [{ key: 'sqlite', label: 'SQLite' }] });

      await decisions.answer(HUMAN, escalation.id, { key: 'sqlite', text: 'use sqlite' });
      const relayed = await decisions.answer(conductor(), worker.id, { text: 'Use SQLite.' });

      expect(relayed.status).toBe('answered');
      const w = wake.calls.find((c) => c.agentId === workerId && c.input.source === 'decision_answered');
      expect(w?.input.payload).toMatchObject({ decisionId: worker.id, answer: { text: 'Use SQLite.' } });
    });

    it('a repeat ask by the same owner still supersedes, but a same-kind ask by the other owner does not', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const first = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q1', askedByAgentId: workerId });
      const second = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q2', askedByAgentId: workerId });
      expect(decisions.get(first.id).status).toBe('superseded');
      expect(decisions.get(second.id).status).toBe('open');

      const humanOwned = decisions.create(conductor(), { ticketId: t.id, kind: 'question', title: 'escalation' });
      expect(decisions.get(second.id).status).toBe('open');
      expect(decisions.get(humanOwned.id).status).toBe('open');
    });
  });

  it('records the answer verbatim and wakes the asking agent', async () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', askedByAgentId: workerId, options: [{ key: 'sqlite', label: 'SQLite' }] });
    const answered = await decisions.answer(HUMAN, d.id, { key: 'sqlite', text: 'yes, sqlite please' });
    expect(answered.status).toBe('answered');
    expect(answered.answerText).toBe('yes, sqlite please');
    expect(answered.answeredByKind).toBe('human');
    const w = wake.calls.find((c) => c.input.source === 'decision_answered');
    expect(w?.agentId).toBe(workerId);
    expect(w?.input.payload).toMatchObject({ decisionId: d.id, answer: { key: 'sqlite', text: 'yes, sqlite please' } });
  });

  it("interrupts the worker's running turn when its decision is answered (VS-662)", async () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    const cancel = vi.fn(async () => undefined);
    h.services.runs = { cancel } as never;
    runState(h.ctx).active.set('run-worker', {
      runId: 'run-worker', agentId: workerId, startedAt: Date.now(), pid: 1, cancel: async () => undefined,
    });
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', askedByAgentId: workerId, options: [{ key: 'sqlite', label: 'SQLite' }] });

    await decisions.answer(HUMAN, d.id, { key: 'sqlite', text: 'use sqlite' });

    expect(cancel).toHaveBeenCalledWith(HUMAN, 'run-worker', 'interrupt', 'message');
    const w = wake.calls.find((c) => c.input.source === 'decision_answered');
    expect(w!.input.payload).toMatchObject({ decisionId: d.id, interruptedRunId: 'run-worker' });
  });

  it('rejects an unknown option and a second answer', async () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q', options: [{ key: 'a', label: 'A' }] });
    await expect(decisions.answer(HUMAN, d.id, { key: 'nope' })).rejects.toMatchObject({ code: 'validation' });
    await decisions.answer(HUMAN, d.id, { key: 'a' });
    await expect(decisions.answer(HUMAN, d.id, { key: 'a' })).rejects.toMatchObject({ code: 'wrong_status', details: { status: 'answered' } });
  });

  it('names the replacement when a stale answer hits a superseded decision, and never applies to it', async () => {
    const t = ticket();
    const first = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'v1', correlationKey: `plan_approval:${t.id}` });
    const second = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'v2', correlationKey: `plan_approval:${t.id}` });

    await expect(decisions.answer(HUMAN, first.id, { key: 'approve' })).rejects.toMatchObject({
      code: 'wrong_status',
      details: { status: 'superseded', supersededBy: second.id },
    });

    // The stale answer left the replacement exactly as it was — nothing about it was ever touched.
    const untouched = decisions.get(second.id);
    expect(untouched.status).toBe('open');
    expect(untouched.answerKey).toBeNull();
    expect(untouched.answeredAt).toBeNull();
  });

  it('omits supersededBy for an expired decision, which has no replacement', async () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q', allowFreeText: true });
    h.db.update('decisions', d.id, { status: 'expired' });
    await expect(decisions.answer(HUMAN, d.id, { text: 'too late' })).rejects.toMatchObject({
      code: 'wrong_status',
      details: { status: 'expired' },
    });
    expect(decisions.get(d.id).answerText).toBeNull();
  });

  describe('plan approval side effects', () => {
    const proposed = () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed' });
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan', askedByAgentId: workerId });
      markLooked(d.id);
      return { t, d, workerId };
    };

    it('approve moves the ticket to approved and wakes the worker', async () => {
      const { t, d, workerId } = proposed();
      await decisions.answer(HUMAN, d.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('approved');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('revise sends it back to proposing with the feedback as a comment', async () => {
      const { t, d } = proposed();
      await decisions.answer(HUMAN, d.id, { key: 'revise', text: 'split the migration out' });
      expect(tickets.get(t.id).status).toBe('proposing');
      expect(tickets.comments(t.id).some((c) => c.body.includes('split the migration out'))).toBe(true);
    });

    it('reject cancels the ticket', async () => {
      const { t, d } = proposed();
      await decisions.answer(HUMAN, d.id, { key: 'reject', text: 'not now' });
      expect(tickets.get(t.id).status).toBe('cancelled');
    });
  });

  describe('action approval side effects', () => {
    const ACTION_OPTS = [
      { key: 'approve', label: 'Approve' },
      { key: 'revise', label: 'Revise' },
      { key: 'reject', label: 'Reject' },
    ];
    const inProgress = () => {
      const t = ticket({ kind: 'operational', title: 'Restart the daemon' });
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'in_progress', workerId });
      const d = decisions.create(AGENT, {
        ticketId: t.id, kind: 'action_approval', owner: 'human', title: 'Approve the action',
        options: ACTION_OPTS, askedByAgentId: workerId, correlationKey: `action_approval:${t.id}`,
      });
      markLooked(d.id);
      return { t, d, workerId };
    };

    it('stays human-owned even when the project would auto-grant a plan', () => {
      h.db.update('projects', h.projectId, { policiesJson: { proposalApproval: 'conductor' } });
      const t = ticket({ kind: 'operational', title: 'Restart' });
      expect(decisions.create(AGENT, { ticketId: t.id, kind: 'action_approval', title: 'x', options: ACTION_OPTS }).owner).toBe('human');
    });

    it('approve leaves the ticket in_progress and wakes the worker', async () => {
      const { t, d, workerId } = inProgress();
      await decisions.answer(HUMAN, d.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('in_progress');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'decision_answered')).toBe(true);
    });

    it('revise leaves the ticket in_progress, records feedback, and wakes the worker', async () => {
      const { t, d, workerId } = inProgress();
      await decisions.answer(HUMAN, d.id, { key: 'revise', text: 'name the host' });
      expect(tickets.get(t.id).status).toBe('in_progress');
      expect(tickets.comments(t.id).some((c) => c.body.includes('name the host'))).toBe(true);
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'decision_answered')).toBe(true);
    });

    it('reject cancels the ticket', async () => {
      const { t, d } = inProgress();
      await decisions.answer(HUMAN, d.id, { key: 'reject', text: 'not now' });
      expect(tickets.get(t.id).status).toBe('cancelled');
    });
  });

  // VS-118: answering "retry now" on a parking decision used to send the ticket to `todo` whenever
  // `t.executionRunId` happened to be null — which it always is by the time this runs, since
  // `finalize()` clears it before the park that raised this decision. It must restore the status the
  // ticket actually held before it was parked.
  it('retry now restores the ticket to the status it held before it was blocked', async () => {
    const relaunch = vi.fn(async () => undefined);
    h.services.workers = { relaunch } as never;
    const t = ticket();
    h.db.update('tickets', t.id, { status: 'in_progress' });
    await tickets.transition(SYSTEM, t.id, { to: 'blocked', unblock: { owner: 'human', action: 'retry or cancel' } });
    expect(tickets.get(t.id).blockedFromStatus).toBe('in_progress');
    const d = decisions.create(SYSTEM, {
      kind: 'retry_approval', owner: 'human', ticketId: t.id, title: 'Worker failed',
      target: { agentId: 'ag_1', ticketId: t.id },
    });

    await decisions.answer(HUMAN, d.id, { key: 'retry' });

    expect(relaunch).toHaveBeenCalledWith(HUMAN, 'ag_1', 'the human asked for a retry');
    expect(tickets.get(t.id).status).toBe('in_progress');
  });

  it('answering switch:deep writes the option and resumes without booking a retry (VS-238)', async () => {
    h.ctx.config.models.workerOptions = [
      { id: 'standard', description: 'Specified work.', runtime: 'opencode', model: 'glm' },
      { id: 'deep', description: 'Cause unknown.', runtime: 'claude', model: 'opus' },
    ];
    const t = ticket({ workerModelId: 'standard' });
    const workerId = h.addWorker(t.id);
    const path = h.db.get<{ worktreePath: string; branch: string }>('SELECT worktree_path, branch FROM agents WHERE id = ?', [workerId])!;
    h.db.update('agents', workerId, { status: 'paused', pauseReason: 'rate_limit: waiting for a human', pauseDetailJson: { family: 'provider_quota' } });
    h.db.update('tickets', t.id, { status: 'blocked', workerModelId: 'standard' });
    const resume = vi.fn((actor: Actor, id: string) => {
      h.db.update('agents', id, { status: 'active', pauseReason: null, pauseDetailJson: null });
      return h.db.get('SELECT * FROM agents WHERE id = ?', [id]);
    });
    h.services.workers = { resume, relaunch: vi.fn(async () => undefined) } as never;
    const d = decisions.create(SYSTEM, {
      kind: 'retry_approval', owner: 'human', ticketId: t.id, title: 'usage limit',
      options: [
        { key: 'retry', label: 'Retry now' },
        { key: 'retry_1h', label: 'Retry in an hour' },
        { key: 'switch:deep', label: 'Continue on deep' },
        { key: 'cancel', label: 'Cancel' },
      ],
      target: { agentId: workerId, ticketId: t.id },
    });

    await decisions.answer(HUMAN, d.id, { key: 'switch:deep' });

    expect(tickets.get(t.id).workerModelId).toBe('deep');
    expect(resume).toHaveBeenCalledWith(HUMAN, workerId);
    expect(h.db.get<{ status: string; worktreePath: string; branch: string }>('SELECT status, worktree_path, branch FROM agents WHERE id = ?', [workerId]))
      .toMatchObject({ status: 'active', worktreePath: path.worktreePath, branch: path.branch });
    expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'retry')).toBe(false);
  });

  // VS-625: a card that describes a worker being stopped is stale the moment something other than
  // an answer puts it back to work. Closing it, and refusing to act on a late answer, are what stop
  // a second turn starting on top of a healthy one.
  describe('closing a worker\'s stop cards (VS-625)', () => {
    it('supersedes an open decision with the reason recorded', async () => {
      const t = ticket();
      const d = decisions.create(SYSTEM, { ticketId: t.id, kind: 'question', title: 'q' });
      const closed = decisions.supersede(HUMAN, d.id, 'the worker was resumed by the weaver at 2026-09-20T00:00:00.000Z');
      expect(closed.status).toBe('superseded');
      expect(decisions.get(d.id)).toMatchObject({
        status: 'superseded',
        answerText: 'the worker was resumed by the weaver at 2026-09-20T00:00:00.000Z',
      });
      await new Promise((r) => setImmediate(r));
      expect(h.events.some((e) => e.type === 'decision.superseded')).toBe(true);
    });

    it('refuses to rewrite a decision that is not open', () => {
      const t = ticket();
      const d = decisions.create(SYSTEM, { ticketId: t.id, kind: 'question', title: 'q' });
      decisions.supersede(HUMAN, d.id, 'first');
      expect(() => decisions.supersede(HUMAN, d.id, 'again')).toThrow(/superseded/);
      expect(decisions.get(d.id).answerText).toBe('first');
    });

    it('closes only the named worker\'s parking and stalled cards, and no other kind', () => {
      const t = ticket();
      const worker = h.addWorker(t.id);
      const t2 = ticket({ title: 'second' });
      const other = h.addWorker(t2.id);
      const parking = decisions.create(SYSTEM, { ticketId: t.id, kind: 'retry_approval', owner: 'human', title: 'failed', target: { agentId: worker, ticketId: t.id }, correlationKey: `retry:${worker}` });
      const stalled = decisions.create(SYSTEM, { ticketId: t.id, kind: 'gate_finding', owner: 'weaver', title: 'stalled', correlationKey: `stalled-worker:${worker}` });
      const otherParking = decisions.create(SYSTEM, { ticketId: t2.id, kind: 'retry_approval', owner: 'human', title: 'other', target: { agentId: other, ticketId: t2.id }, correlationKey: `retry:${other}` });
      const question = decisions.create(SYSTEM, { ticketId: t.id, kind: 'question', title: 'unrelated' });

      const closed = decisions.supersedeWorkerStopCards(HUMAN, worker, 'the worker was resumed by the human at 2026-09-20T00:00:00.000Z');

      expect(closed).toBe(2);
      expect(decisions.get(parking.id).status).toBe('superseded');
      expect(decisions.get(stalled.id).status).toBe('superseded');
      expect(decisions.get(otherParking.id).status).toBe('open');
      expect(decisions.get(question.id).status).toBe('open');
    });

    it('leaves an already-answered parking card alone', async () => {
      const t = ticket();
      const worker = h.addWorker(t.id);
      h.db.update('agents', worker, { status: 'paused', pauseReason: 'boom', pauseDetailJson: { family: 'unknown' } });
      const relaunch = vi.fn(async () => undefined);
      h.services.workers = { relaunch } as never;
      const parking = decisions.create(SYSTEM, { ticketId: t.id, kind: 'retry_approval', owner: 'human', title: 'failed', correlationKey: `retry:${worker}`, target: { agentId: worker, ticketId: t.id } });

      await decisions.answer(HUMAN, parking.id, { key: 'retry' });
      decisions.supersedeWorkerStopCards(HUMAN, worker, 'the worker was resumed');

      expect(decisions.get(parking.id).status).toBe('answered');
    });
  });

  describe('answering a stale parking card starts nothing (VS-625)', () => {
    const OPTIONS = [
      { key: 'retry', label: 'Retry now' },
      { key: 'retry_1h', label: 'Retry in an hour' },
      { key: 'switch:deep', label: 'Continue on deep' },
      { key: 'cancel', label: 'Cancel the ticket' },
    ];

    /** A blocked ticket with a parked-looking parking card for a worker whose status is `status`. */
    function openCard(status: string): { ticketId: string; workerId: string; id: string } {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('agents', workerId, { status, pauseReason: 'boom: waiting for a human', pauseDetailJson: { family: 'unknown' } });
      h.db.update('tickets', t.id, { status: 'blocked', blockedFromStatus: 'in_progress', workerModelId: 'standard' });
      const d = decisions.create(SYSTEM, { ticketId: t.id, kind: 'retry_approval', owner: 'human', title: 'Worker failed', options: OPTIONS, correlationKey: `retry:${workerId}`, target: { agentId: workerId, ticketId: t.id } });
      return { ticketId: t.id, workerId, id: d.id };
    }

    const commentBodies = (ticketId: string): string[] =>
      h.db.all<{ body: string }>('SELECT body FROM ticket_comments WHERE ticket_id = ?', [ticketId]).map((c) => c.body);

    it('does not relaunch or wake a worker that is already running', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'claude', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'claude', model: 'opus' },
      ];
      const { ticketId, workerId, id } = openCard('active');
      const relaunch = vi.fn(async () => undefined);
      const resume = vi.fn();
      const cancel = vi.fn();
      h.services.workers = { relaunch, resume, cancel } as never;
      wake.calls.length = 0;

      await decisions.answer(HUMAN, id, { key: 'retry' });

      expect(relaunch).not.toHaveBeenCalled();
      expect(wake.calls.filter((c) => c.agentId === workerId)).toHaveLength(0);
      expect(tickets.get(ticketId).status).toBe('blocked');
      expect(commentBodies(ticketId).some((b) => /already resumed/i.test(b))).toBe(true);
    });

    it('books no deferred retry on a stale card', async () => {
      const { id, workerId } = openCard('active');
      h.services.workers = { relaunch: vi.fn(async () => undefined), resume: vi.fn(), cancel: vi.fn() } as never;
      wake.calls.length = 0;

      await decisions.answer(HUMAN, id, { key: 'retry_1h' });

      expect(wake.calls.filter((c) => c.agentId === workerId && c.input.source === 'retry')).toHaveLength(0);
    });

    it('changes no catalog option on a stale card', async () => {
      h.ctx.config.models.workerOptions = [
        { id: 'standard', description: 'Specified work.', runtime: 'claude', model: null },
        { id: 'deep', description: 'Cause unknown.', runtime: 'claude', model: 'opus' },
      ];
      const { id, ticketId } = openCard('active');
      h.services.workers = { relaunch: vi.fn(async () => undefined), resume: vi.fn(), cancel: vi.fn() } as never;

      await decisions.answer(HUMAN, id, { key: 'switch:deep' });

      expect(tickets.get(ticketId).workerModelId).toBe('standard');
    });

    it('cancels nothing on a stale card', async () => {
      const { id, ticketId, workerId } = openCard('active');
      h.services.workers = { relaunch: vi.fn(async () => undefined), resume: vi.fn(), cancel: vi.fn() } as never;

      await decisions.answer(HUMAN, id, { key: 'cancel' });

      expect(tickets.get(ticketId).status).toBe('blocked');
      expect(wake.calls.filter((c) => c.agentId === workerId)).toHaveLength(0);
    });

    it('still acts on a card whose worker is parked', async () => {
      const { id, ticketId, workerId } = openCard('paused');
      const relaunch = vi.fn(async () => undefined);
      h.services.workers = { relaunch, resume: vi.fn(), cancel: vi.fn() } as never;

      await decisions.answer(HUMAN, id, { key: 'retry' });

      expect(relaunch).toHaveBeenCalledWith(HUMAN, workerId, 'the human asked for a retry');
      expect(tickets.get(ticketId).status).toBe('in_progress');
    });
  });

  it('merge approval approve moves the ticket to merging and wakes the worker', async () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.update('tickets', t.id, { status: 'in_review' });
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?', askedByAgentId: workerId });
    markLooked(d.id);
    await decisions.answer(HUMAN, d.id, { key: 'approve' });
    expect(tickets.get(t.id).status).toBe('merging');
    expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'merge_approved')).toBe(true);
  });

  describe('the merge card names where the work lands (VS-568)', () => {
    async function mergeCardFor(landingBranch: string | null): Promise<{ title: string; label: string | undefined }> {
      h.db.update('projects', h.projectId, { landingBranch });
      const t = ticket({ kind: 'task' });
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/9' });
      h.db.update('tickets', t.id, { status: 'in_progress' });
      await tickets.transition(HUMAN, t.id, { to: 'in_review' });
      const d = decisions.list({ ticketId: t.id }).find((x) => x.kind === 'merge_approval')!;
      return { title: d.title, label: d.options.find((o) => o.key === 'approve')?.label };
    }

    it('says Land on edge when the project lands on edge', async () => {
      const card = await mergeCardFor('edge');
      expect(card.title).toMatch(/^Land on edge for /);
      expect(card.label).toBe('Land on edge');
    });

    it('keeps the plain merge copy when landing is the default branch', async () => {
      const card = await mergeCardFor(null);
      expect(card.title).toMatch(/^Approve the merge for /);
      expect(card.label).toBe('Approve merge');
    });
  });

  describe('promotion approval (VS-568)', () => {
    const promote = () => decisions.create(HUMAN, { kind: 'promotion_approval', projectId: h.projectId, title: 'Promote edge to main', correlationKey: `promotion_approval:${h.projectId}`, options: [{ key: 'approve', label: 'Promote edge to main' }, { key: 'decline', label: 'Not now' }] });
    let execute: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      execute = vi.fn(async () => ({ promotedHead: 'abc' }));
      h.services.promotion = { execute, currentHead: vi.fn(async () => 'abc') } as never;
    });

    it('belongs to a project and no ticket, and is human-owned', () => {
      const d = promote();
      expect(d).toMatchObject({ ticketId: null, projectId: h.projectId, owner: 'human', status: 'open' });
    });

    it('is held until the weaver reviews it, and promotes nothing meanwhile', async () => {
      const d = promote();
      await expect(decisions.answer(HUMAN, d.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });
      expect(execute).not.toHaveBeenCalled();
      expect(decisions.get(d.id).status).toBe('open');
    });

    it('promotes on a human approval after review', async () => {
      const d = promote();
      await markLooked(d.id);
      await decisions.answer(HUMAN, d.id, { key: 'approve' });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(decisions.get(d.id).status).toBe('answered');
    });

    it('leaves the card open when the promotion is refused', async () => {
      const d = promote();
      await markLooked(d.id);
      execute.mockRejectedValueOnce(new Error('edge is behind main'));
      await expect(decisions.answer(HUMAN, d.id, { key: 'approve' })).rejects.toThrow(/behind main/);
      expect(decisions.get(d.id).status).toBe('open');
    });

    it('declining never promotes', async () => {
      const d = promote();
      await decisions.answer(HUMAN, d.id, { key: 'decline' });
      expect(execute).not.toHaveBeenCalled();
    });

    it('YOLO does not answer it: a looked mark leaves it open', async () => {
      h.db.update('projects', h.projectId, { policiesJson: { yolo: true } });
      const d = promote();
      await markLooked(d.id);
      expect(decisions.get(d.id).status).toBe('open');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('merge approval changes sends the ticket back to in_progress', async () => {
    const t = ticket();
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
    h.db.update('tickets', t.id, { status: 'in_review' });
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
    await decisions.answer(HUMAN, d.id, { key: 'changes', text: 'tests missing' });
    expect(tickets.get(t.id).status).toBe('in_progress');
  });

  it('hire approval activates the role, and nothing in the answer can name a runtime', async () => {
    const d = decisions.create(HUMAN, { kind: 'hire_approval', title: 'Hire a backend engineer', target: { roleId: h.roleId } });
    await decisions.answer(HUMAN, d.id, { key: 'approve' });
    expect(roles.activate).toHaveBeenCalledWith(HUMAN, h.roleId);

    // A `runtime:` key was the per-role override (VS-77): with no such option offered it is now an
    // unknown answer, refused rather than silently acted on.
    const d2 = decisions.create(HUMAN, {
      kind: 'hire_approval', title: 'Hire again', target: { roleId: h.roleId }, correlationKey: 'hire:2',
      options: [{ key: 'approve', label: 'Approve' }, { key: 'reject', label: 'Reject' }],
    });
    await expect(decisions.answer(HUMAN, d2.id, { key: 'runtime:codex' })).rejects.toMatchObject({ code: 'validation' });
  });

  // VS-335: a permission change reuses the hire_approval kind but must apply the carried patch, never
  // activate the already-live role or start the project's describe scout.
  it('a role-permission approval applies the stored patch instead of activating the role', async () => {
    const patch = { permission: { mode: 'restricted', allowed: [], denied: [] } };
    const d = decisions.create(HUMAN, {
      kind: 'hire_approval', title: 'Change permission for Backend Engineer?', correlationKey: `role-permission:${h.roleId}`,
      target: { roleId: h.roleId, permissionChange: true, patch, reason: 'tighten it', applyToRunning: true },
      options: [{ key: 'approve', label: 'Approve' }, { key: 'reject', label: 'Reject' }],
    });
    await decisions.answer(HUMAN, d.id, { key: 'approve' });
    expect(roles.update).toHaveBeenCalledWith(HUMAN, h.roleId, patch, 'tighten it', { applyToRunning: true });
    expect(roles.activate).not.toHaveBeenCalled();

    const reject = decisions.create(HUMAN, {
      kind: 'hire_approval', title: 'Change permission again?', correlationKey: `role-permission:${h.roleId}-again`,
      target: { roleId: h.roleId, permissionChange: true, patch, reason: 'tighten it' },
      options: [{ key: 'approve', label: 'Approve' }, { key: 'reject', label: 'Reject' }],
    });
    roles.update.mockClear();
    await decisions.answer(HUMAN, reject.id, { key: 'reject' });
    expect(roles.update).not.toHaveBeenCalled();
  });

  it('discard approval marks the ticket and notifies the conductor', async () => {
    const t = ticket();
    const d = decisions.create(HUMAN, { ticketId: t.id, kind: 'discard_approval', title: 'Discard unlanded work?' });
    await decisions.answer(HUMAN, d.id, { key: 'approve' });
    expect(tickets.comments(t.id).some((c) => c.body.includes('Discard approved'))).toBe(true);
    expect(wake.calls.some((c) => c.agentId === h.conductorId && c.input.source === 'decision_answered')).toBe(true);
  });

  it('remembers durable answers in the knowledge base', async () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?' });
    await decisions.answer(HUMAN, d.id, { text: 'sqlite', remember: true });
    expect(knowledge.appendDecision).toHaveBeenCalledTimes(1);
  });

  it('expires due decisions, blocks their ticket and wakes the conductor', async () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', expiresInHours: 1 });
    h.db.update('decisions', d.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await decisions.expireDue();
    expect(expired.map((x) => x.id)).toEqual([d.id]);
    expect(decisions.get(d.id).status).toBe('expired');
    const after = tickets.get(t.id);
    expect(after.status).toBe('blocked');
    expect(after.unblock).toMatchObject({ owner: 'human' });
    expect(wake.calls.some((c) => c.agentId === h.conductorId && c.input.source === 'system')).toBe(true);
  });

  it('withdraws an open decision', () => {
    const d = decisions.create(HUMAN, { kind: 'question', title: 'q' });
    expect(decisions.withdraw(HUMAN, d.id, 'no longer relevant').status).toBe('withdrawn');
    expect(decisions.list({ status: ['withdrawn'] })).toHaveLength(1);
  });

  it('supersedeForTarget closes the open decision for a correlation key', () => {
    const t = ticket();
    decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'v1', correlationKey: `plan_approval:${t.id}` });
    expect(decisions.supersedeForTarget(HUMAN, t.id, `plan_approval:${t.id}`)).toBe(1);
    expect(decisions.list({ ticketId: t.id, status: ['open'] })).toHaveLength(0);
  });

  it('withdrawForTicket closes every open decision on a ticket, whatever kind, and leaves other decisions alone', async () => {
    const t = ticket();
    const merge = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'merge' });
    const question = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q' });
    const answered = decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'already answered' });
    await decisions.answer(HUMAN, answered.id, { key: 'ack' });
    const untied = decisions.create(HUMAN, { kind: 'hire_approval', title: 'hire someone' });

    expect(decisions.withdrawForTicket(SYSTEM, t.id, `${t.identifier} reached done`)).toBe(2);

    expect(decisions.get(merge.id)).toMatchObject({ status: 'withdrawn', answerText: `${t.identifier} reached done` });
    expect(decisions.get(question.id)).toMatchObject({ status: 'withdrawn', answerText: `${t.identifier} reached done` });
    expect(decisions.get(answered.id)).toMatchObject({ status: 'answered', answerKey: 'ack' });
    expect(decisions.get(untied.id).status).toBe('open');
  });

  it('closes an open decision when its ticket reaches done', async () => {
    const t = ticket({ kind: 'task' });
    await tickets.transition(AGENT, t.id, { to: 'in_progress' });
    const merge = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Approve the merge' });
    await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
    expect(decisions.get(merge.id).status).toBe('withdrawn');
  });

  it('closes an open decision when its ticket is cancelled', () => {
    const t = ticket({ kind: 'task' });
    const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan' });
    tickets.cancel(HUMAN, t.id, 'not needed after all');
    expect(decisions.get(plan.id).status).toBe('withdrawn');
  });

  it('leaves an already-answered decision alone when its ticket reaches a terminal status', async () => {
    const t = ticket({ kind: 'task' });
    await tickets.transition(AGENT, t.id, { to: 'in_progress' });
    const finding = decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'Something noticed' });
    const answered = await decisions.answer(HUMAN, finding.id, { key: 'ack', text: 'noted' });
    await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
    expect(decisions.get(finding.id)).toMatchObject({ status: 'answered', answerKey: 'ack', answerText: 'noted', answeredAt: answered.answeredAt });
  });

  it('creates workspace-level decisions without a ticket', () => {
    const d = decisions.create(HUMAN, { kind: 'approval', title: 'Add a project?' });
    expect(d.ticketId).toBeNull();
    expect(decisions.get(d.id).correlationKey).toBe('approval:human:workspace');
    expect(newId()).toBeTruthy();
  });

  // ---------- VS-306: a decision named at a ticket that is already terminal ----------

  it('creates a follow-up question detached when its ticket has already finished', async () => {
    const t = ticket({ kind: 'task' });
    await tickets.transition(AGENT, t.id, { to: 'in_progress' });
    await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });

    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'What did you learn?' });

    expect(d.status).toBe('open');
    expect(d.ticketId).toBeNull();
    expect(d.projectId).toBe(h.projectId);
    expect(d.correlationKey).toBe(`question:human:${t.id}`);
    // The ask stays legitimate: it is answerable, not refused.
    expect((await decisions.answer(HUMAN, d.id, { text: 'the thing' })).status).toBe('answered');
  });

  it('keeps the ticket attachment when the ticket is not terminal', () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?' });
    expect(d.ticketId).toBe(t.id);
    expect(d.correlationKey).toBe(`question:human:${t.id}`);
  });

  it('keeps an archive-backfill merge approval attached to a finished ticket (VS-389)', async () => {
    const t = ticket({ kind: 'task' });
    await tickets.transition(AGENT, t.id, { to: 'in_progress' });
    await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });

    const d = decisions.create(AGENT, {
      ticketId: t.id, kind: 'merge_approval', title: 'Approve the spec archive', owner: 'human',
      correlationKey: `merge_approval:archive:${t.id}:x`,
      attachToTerminal: true,
      target: { archive: { changeName: 'x', branch: 'ac/archive-x', prUrl: 'https://example.com/pr/1' } },
    });
    expect(d.ticketId).toBe(t.id);
    expect(d.projectId).toBe(h.projectId);

    // An ordinary card on the same finished ticket is still detached (VS-306).
    const plain = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'plain merge' });
    expect(plain.ticketId).toBeNull();
  });

  it('a detached follow-up neither supersedes nor is superseded by a workspace-level question', async () => {
    const t = ticket({ kind: 'task' });
    await tickets.transition(AGENT, t.id, { to: 'in_progress' });
    await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });

    const workspaceQ = decisions.create(HUMAN, { kind: 'question', title: 'workspace question' });
    const detached = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'follow-up on the finished ticket' });
    expect(detached.ticketId).toBeNull();
    expect(detached.correlationKey).toBe(`question:human:${t.id}`);
    // Occupying its own bucket, the detached card must not have killed the workspace question.
    expect(decisions.get(workspaceQ.id).status).toBe('open');

    // Nor may the next workspace-level question kill the detached one.
    const workspaceQ2 = decisions.create(HUMAN, { kind: 'question', title: 'another workspace question' });
    expect(decisions.get(detached.id).status).toBe('open');
    expect(decisions.get(workspaceQ.id).status).toBe('superseded');
    expect(workspaceQ2.status).toBe('open');
  });

  describe('the stale-terminal sweep', () => {
    const DAY = 24 * 3600e3;
    const stale = () => new Date(Date.now() - 48 * 3600e3).toISOString();

    it('withdraws an old open decision on a terminal ticket and leaves a fresh one', async () => {
      const t = ticket({ kind: 'task' });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
      // The historical shape the guard cannot reach: rows already attached to a finished ticket.
      const oldId = newId();
      const freshId = newId();
      for (const [id, title, createdAt] of [[oldId, 'stale', stale()], [freshId, 'fresh', new Date().toISOString()]] as const) {
        h.db.insert('decisions', {
          id, workspaceId: h.workspaceId, ticketId: t.id, projectId: h.projectId, kind: 'question', owner: 'human',
          title, context: '', optionsJson: [], allowFreeText: 1, status: 'open', correlationKey: `question:${t.id}-${title}`, createdAt,
        });
      }

      expect(decisions.sweepTerminalTickets(SYSTEM, DAY)).toBe(1);
      expect(decisions.get(oldId)).toMatchObject({ status: 'withdrawn' });
      expect(decisions.get(oldId).answerText).toContain(t.identifier);
      expect(decisions.get(freshId).status).toBe('open');
    });

    it('does not touch an old decision on a live ticket', async () => {
      const t = ticket({ kind: 'task' });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      const id = newId();
      h.db.insert('decisions', {
        id, workspaceId: h.workspaceId, ticketId: t.id, projectId: h.projectId, kind: 'question', owner: 'human',
        title: 'live', context: '', optionsJson: [], allowFreeText: 1, status: 'open', correlationKey: `question:${t.id}`, createdAt: stale(),
      });

      expect(decisions.sweepTerminalTickets(SYSTEM, DAY)).toBe(0);
      expect(decisions.get(id).status).toBe('open');
    });

    it('never closes an approval gate on a live ticket, however old', () => {
      const t = ticket();
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan' });
      h.db.update('tickets', t.id, { status: 'proposed' });
      h.db.update('decisions', plan.id, { createdAt: stale() });

      expect(decisions.sweepTerminalTickets(SYSTEM, DAY)).toBe(0);
      expect(decisions.get(plan.id).status).toBe('open');
    });

    it('does not touch an approval the repair scan re-raised for a non-terminal ticket', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const repaired = await tickets.repairApprovals();
      expect(repaired.some((r) => r.id === t.id)).toBe(true);
      const open = decisions.list({ ticketId: t.id, status: ['open'] });
      expect(open).toHaveLength(1);
      h.db.update('decisions', open[0]!.id, { createdAt: stale() });

      expect(decisions.sweepTerminalTickets(SYSTEM, DAY)).toBe(0);
      expect(decisions.get(open[0]!.id).status).toBe('open');
    });

    it('leaves an archive-backfill merge approval on a finished ticket open (VS-389)', async () => {
      const t = ticket({ kind: 'task' });
      await tickets.transition(AGENT, t.id, { to: 'in_progress' });
      await tickets.transition(AGENT, t.id, { to: 'done', note: 'ending: nothing to land' });
      const d = decisions.create(AGENT, {
        ticketId: t.id, kind: 'merge_approval', title: 'Approve the spec archive', owner: 'human',
        correlationKey: `merge_approval:archive:${t.id}:x`, attachToTerminal: true,
        target: { archive: { changeName: 'x', branch: 'ac/archive-x', prUrl: 'https://example.com/pr/1' } },
      });
      h.db.update('decisions', d.id, { createdAt: stale() });

      expect(decisions.sweepTerminalTickets(SYSTEM, DAY)).toBe(0);
      expect(decisions.get(d.id).status).toBe('open');
    });
  });
  // ---------- VS-92: the project a card names ----------

  describe('the project a decision belongs to', () => {
    it('takes the ticket\'s project, and the ticket wins over a project the asker named', () => {
      const t = ticket();
      expect(decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which?' }).projectId).toBe(h.projectId);
      // Not overridable: a card naming a project other than its ticket's would be a lie.
      const other = newId();
      h.db.insert('projects', {
        id: other, workspaceId: h.ctx.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@e:a/w.git', defaultBranch: 'main',
        clonePath: '/tmp/web', maxWorkers: 2, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {}, status: 'ready',
        createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
      });
      expect(decisions.create(AGENT, { ticketId: t.id, projectId: other, kind: 'question', title: 'Which?', correlationKey: 'q2' }).projectId).toBe(h.projectId);
    });

    it('takes the project the asker named when there is no ticket', () => {
      const d = decisions.create(AGENT, { projectId: h.projectId, kind: 'question', title: 'Which region?' });
      expect(d.projectId).toBe(h.projectId);
      expect(d.ticketId).toBeNull();
    });

    it('is null for a workspace-wide question, which surfaces render as the workspace', () => {
      expect(decisions.create(AGENT, { kind: 'question', title: 'Which region?' }).projectId).toBeNull();
    });

    it('refuses a project that is not one of this workspace\'s', () => {
      expect(() => decisions.create(AGENT, { projectId: 'pr_nope', kind: 'question', title: 'Which?' })).toThrow(/project pr_nope not found/);
    });
  });

  // ---------- VS-92: inputs ----------

  const INPUTS = [
    { key: 'base_url', label: 'Base URL', type: 'text' as const, required: true },
    { key: 'notes', label: 'Anything else', type: 'multiline' as const },
    { key: 'regions', label: 'Regions', type: 'multiselect' as const, choices: [{ key: 'eu', label: 'EU' }, { key: 'us', label: 'US' }, { key: 'ap', label: 'APAC' }] },
  ];

  describe('asking for values', () => {
    it('refuses a decision whose inputs could not be answered', () => {
      const bad = (inputs: unknown[], match: RegExp): void =>
        expect(() => decisions.create(AGENT, { kind: 'question', title: 'x', inputs: inputs as never, correlationKey: newId() })).toThrow(match);
      bad([{ key: '', label: 'No key', type: 'text' }], /needs a key/);
      bad([{ key: 'a', label: '', type: 'text' }], /needs a label/);
      bad([{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'Again', type: 'text' }], /share the key "a"/);
      bad([{ key: 'r', label: 'Regions', type: 'multiselect' }], /needs at least one choice/);
      bad([{ key: 'r', label: 'Regions', type: 'multiselect', choices: [] }], /needs at least one choice/);
      bad([{ key: 'r', label: 'R', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }, { key: 'eu', label: 'EU again' }] }], /repeats the choice "eu"/);
      bad([{ key: 't', label: 'Token', type: 'secret' }], /needs a secretName/);
      bad([{ key: 't', label: 'Token', type: 'secret', secretName: 'lower case' }], /needs a secretName/);
      expect(decisions.list()).toHaveLength(0);
    });

    it('records each type, keyed by input, and wakes the asker with the same map', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'How should I reach it?', inputs: INPUTS, askedByAgentId: h.conductorId });
      const answered = await decisions.answer(HUMAN, d.id, { inputs: { base_url: 'https://example.test', regions: ['us', 'eu'] } });
      expect(answered.answerInputs).toEqual({ base_url: 'https://example.test', regions: ['eu', 'us'] });
      // Recorded in the order the choices were offered, so the same set always records the same way.
      expect(answered.answerInputs!.regions).toEqual(['eu', 'us']);
      // An optional input left empty is absent, not present and empty.
      expect(Object.keys(answered.answerInputs!)).not.toContain('notes');
      const woken = wake.calls.at(-1)!;
      expect(woken.input.payload).toMatchObject({ decisionId: d.id, answerInputs: { base_url: 'https://example.test', regions: ['eu', 'us'] } });
    });

    it('lets the weaver answer required choice inputs and applies the same validation', async () => {
      const workerId = h.addWorker(ticket().id);
      const inputs = [
        { key: 'guard_handling', label: 'Guard handling', type: 'single_choice' as const, required: true, choices: [{ key: 'keep', label: 'Keep' }, { key: 'remove', label: 'Remove' }] },
        { key: 'delivery', label: 'Delivery', type: 'single_choice' as const, required: true, choices: [{ key: 'separate', label: 'Separate' }, { key: 'inline', label: 'Inline' }] },
      ];
      const d = decisions.create(AGENT, { kind: 'question', owner: 'weaver', title: 'Which handling?', inputs, askedByAgentId: workerId, correlationKey: newId() });

      await expect(decisions.answer(conductor(), d.id, { inputs: { guard_handling: 'keep' } })).rejects.toThrow(/"delivery".*is required/);
      await expect(decisions.answer(conductor(), d.id, { inputs: { guard_handling: 'unknown', delivery: 'separate' } })).rejects.toThrow(/"unknown" is not a choice.*"guard_handling"/);
      expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(d.id).answerInputs).toBeNull();

      const answered = await decisions.answer(conductor(), d.id, { inputs: { guard_handling: 'keep', delivery: 'separate' } });
      expect(answered.answerInputs).toEqual({ guard_handling: 'keep', delivery: 'separate' });
      expect(wake.calls.at(-1)!.input.payload).toMatchObject({ decisionId: d.id, answerInputs: { guard_handling: 'keep', delivery: 'separate' } });
    });

    it('answers with a choice and values together', async () => {
      const d = decisions.create(AGENT, {
        kind: 'question', title: 'Which and where?', options: [{ key: 'now', label: 'Now' }, { key: 'later', label: 'Later' }], inputs: INPUTS,
      });
      const answered = await decisions.answer(HUMAN, d.id, { key: 'now', inputs: { base_url: 'https://example.test' } });
      expect(answered.answerKey).toBe('now');
      expect(answered.answerInputs).toEqual({ base_url: 'https://example.test' });
    });

    it('refuses an answer that misses a required input, names an input that does not exist, or picks a choice that was not offered', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'How?', inputs: INPUTS });
      await expect(decisions.answer(HUMAN, d.id, { inputs: { notes: 'hi' } })).rejects.toThrow(/"base_url".*is required/);
      await expect(decisions.answer(HUMAN, d.id, { inputs: { base_url: 'x', nope: 'y' } })).rejects.toThrow(/has no input "nope"/);
      await expect(decisions.answer(HUMAN, d.id, { inputs: { base_url: 'x', regions: ['mars'] } })).rejects.toThrow(/"mars" is not a choice/);
      // Nothing was recorded by any of them, and the card is still there to answer.
      expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(d.id).answerInputs).toBeNull();
    });

    it('refuses values for a decision that asks for none', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'Yes or no?', options: [{ key: 'yes', label: 'Yes' }] });
      await expect(decisions.answer(HUMAN, d.id, { key: 'yes', inputs: { anything: 'x' } })).rejects.toThrow(/asks for no inputs/);
      expect(decisions.get(d.id).status).toBe('open');
    });

    it('leaves a decision with no inputs exactly as it was', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'Yes or no?', options: [{ key: 'yes', label: 'Yes' }] });
      expect(d.inputs).toEqual([]);
      const answered = await decisions.answer(HUMAN, d.id, { key: 'yes' });
      expect(answered.answerKey).toBe('yes');
      expect(answered.answerInputs).toBeNull();
      // And it still refuses an empty answer the way it always has.
      const other = decisions.create(AGENT, { kind: 'question', title: 'Yes?', correlationKey: 'q-other' });
      await expect(decisions.answer(HUMAN, other.id, {})).rejects.toThrow(/needs a key or free text/);
    });

    it('answers an inputs-only card without a key or free text', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'Base URL?', allowFreeText: false, inputs: [INPUTS[0]!] });
      const answered = await decisions.answer(HUMAN, d.id, { inputs: { base_url: 'https://example.test' } });
      expect(answered.status).toBe('answered');
      expect(answered.answerInputs).toEqual({ base_url: 'https://example.test' });
    });
  });

  // ---------- VS-342: single-choice inputs and several questions on one card ----------

  describe('a single-choice input', () => {
    const CHOICE = {
      key: 'served', label: 'How is V2 served', type: 'single_choice' as const,
      choices: [
        { key: 'same', label: 'Same app', recommended: true },
        { key: 'separate', label: 'Separate build' },
      ],
    };

    it('refuses a single-choice that could not be rendered or answered', () => {
      const bad = (inputs: unknown[], match: RegExp): void =>
        expect(() => decisions.create(AGENT, { kind: 'question', title: 'x', inputs: inputs as never, correlationKey: newId() })).toThrow(match);
      bad([{ key: 'q', label: 'Q', type: 'single_choice', choices: [{ key: 'a', label: 'A' }] }], /needs at least two choices/);
      bad([{ key: 'q', label: 'Q', type: 'single_choice', choices: [{ key: 'a', label: 'A' }, { key: 'a', label: 'Again' }] }], /repeats the choice "a"/);
      bad([{ key: 'q', label: 'Q', type: 'single_choice', choices: [{ key: 'a', label: 'A', recommended: true }, { key: 'b', label: 'B', recommended: true }] }], /recommends more than one choice/);
      bad([{ key: 'q', label: 'Q', type: 'single_choice', default: 'nope', choices: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }], /defaults to a choice it does not offer/);
      bad([{ key: 's', label: 'S', type: 'secret', secretName: 'TOKEN', default: 'x' }], /cannot carry a default/);
      expect(decisions.list()).toHaveLength(0);
    });

    it('records the chosen key, and the human\'s own words when the input allows them', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'How should V2 be served?', inputs: [CHOICE] });
      expect((await decisions.answer(HUMAN, d.id, { inputs: { served: 'separate' } })).answerInputs).toEqual({ served: 'separate' });

      const other = decisions.create(AGENT, { kind: 'question', title: 'How?', correlationKey: newId(), inputs: [{ ...CHOICE, allowOther: true }] });
      expect((await decisions.answer(HUMAN, other.id, { inputs: { served: 'a standalone gateway' } })).answerInputs).toEqual({ served: 'a standalone gateway' });
    });

    it('refuses a single-choice value that is not one of its choices and not allowed free text', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'How?', inputs: [CHOICE] });
      await expect(decisions.answer(HUMAN, d.id, { inputs: { served: 'something else' } })).rejects.toThrow(/"something else" is not a choice/);
      await expect(decisions.answer(HUMAN, d.id, { inputs: { served: ['same'] } })).rejects.toThrow(/takes a single value/);
      expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(d.id).answerInputs).toBeNull();
    });

    it('round-trips several questions on one card in a single send', async () => {
      const inputs = [
        { key: 'served', label: 'Serve V2', type: 'single_choice' as const, required: true, choices: [{ key: 'same', label: 'Same app', recommended: true }, { key: 'separate', label: 'Separate' }] },
        { key: 'drop', label: 'Drop V1 screens', type: 'single_choice' as const, required: true, choices: [{ key: 'none', label: 'None', recommended: true }, { key: 'settings', label: 'Settings' }] },
        { key: 'work', label: 'Work column maps to', type: 'single_choice' as const, choices: [{ key: 'running', label: 'Running' }, { key: 'active', label: 'Active' }] },
      ];
      const d = decisions.create(AGENT, { kind: 'question', title: 'Four V2 calls', inputs, askedByAgentId: h.conductorId });
      const answered = await decisions.answer(HUMAN, d.id, { inputs: { served: 'separate', drop: 'none' } });
      expect(answered.answerInputs).toEqual({ served: 'separate', drop: 'none' });
      // The optional third question is absent rather than empty, as for every other input.
      expect(Object.keys(answered.answerInputs!)).not.toContain('work');
      expect(wake.calls.at(-1)!.input.payload).toMatchObject({ decisionId: d.id, answerInputs: { served: 'separate', drop: 'none' } });
    });
  });

  // ---------- VS-92: a secret input's value ----------

  describe('a secret input', () => {
    /** Not a credential: a fixture, long enough that the run redactor would treat it as one. */
    const FAKE = 'cf-not-a-real-token-0000000000';
    const secretInputs = [{ key: 'token', label: 'Read-only API token', type: 'secret' as const, required: true, secretName: 'CF_READONLY_TOKEN' }];

    it('registers the value and records only the name it was stored under', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'I need a read-only token', inputs: secretInputs, askedByAgentId: h.conductorId });
      const answered = await decisions.answer(HUMAN, d.id, { inputs: { token: FAKE } });

      expect(answered.answerInputs).toEqual({ token: 'CF_READONLY_TOKEN' });
      expect(h.services.secrets!.value('CF_READONLY_TOKEN')).toBe(FAKE);
      expect(h.services.secrets!.list()).toEqual([{ name: 'CF_READONLY_TOKEN', envVarName: 'CF_READONLY_TOKEN', scope: 'workspace', scopeId: null, hasValue: true }]);
      // What the asker is woken with is the name too — nothing downstream can leak what it never sees.
      expect(JSON.stringify(wake.calls.at(-1))).not.toContain(FAKE);
      expect(wake.calls.at(-1)!.input.payload).toMatchObject({ answerInputs: { token: 'CF_READONLY_TOKEN' } });
    });

    it('leaves the value in no row of the database', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Token?', inputs: secretInputs, askedByAgentId: h.conductorId });
      await decisions.answer(HUMAN, d.id, { inputs: { token: FAKE }, remember: true });
      for (const { name } of h.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")) {
        expect(JSON.stringify(h.db.all(`SELECT * FROM "${name}"`)), `${name} carries the secret value`).not.toContain(FAKE);
      }
    });

    it('refuses the answer and leaves the decision open when the store will not take the value', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'Token?', inputs: secretInputs });
      const real = h.services.secrets!;
      h.services.secrets = { ...real, put: () => { throw new Error('disk full'); } } as never;
      await expect(decisions.answer(HUMAN, d.id, { inputs: { token: FAKE } })).rejects.toThrow(/disk full/);
      h.services.secrets = real;
      // Nothing recorded: a decision claiming a credential was collected that nobody holds is the
      // one outcome this ordering exists to prevent.
      expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(d.id).answerInputs).toBeNull();
      expect(real.has('CF_READONLY_TOKEN')).toBe(false);
    });

    it('still refuses a missing required secret before touching the store', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'Token?', inputs: secretInputs });
      await expect(decisions.answer(HUMAN, d.id, { inputs: { token: '  ' } })).rejects.toThrow(/is required/);
      expect(h.services.secrets!.has('CF_READONLY_TOKEN')).toBe(false);
    });

    it('skips an optional secret the human left empty', async () => {
      const d = decisions.create(AGENT, {
        kind: 'question', title: 'Token?',
        inputs: [{ key: 'token', label: 'Token', type: 'secret', secretName: 'OPTIONAL_TOKEN' }, { key: 'base_url', label: 'Base URL', type: 'text', required: true }],
      });
      const answered = await decisions.answer(HUMAN, d.id, { inputs: { base_url: 'https://example.test' } });
      expect(answered.answerInputs).toEqual({ base_url: 'https://example.test' });
      expect(h.services.secrets!.has('OPTIONAL_TOKEN')).toBe(false);
    });
  });

  describe('conductor review (VS-223)', () => {
    const conductor = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' });

    it('defaults a new plan/merge/action to unseen', () => {
      const t = ticket();
      for (const kind of ['plan_approval', 'merge_approval', 'action_approval'] as const) {
        const d = decisions.create(AGENT, { ticketId: t.id, kind, title: kind, correlationKey: `${kind}:${t.id}` });
        expect(d.weaverReviewStatus).toBe('unseen');
        expect(d.weaverReviewedAt).toBeNull();
        expect(d.weaverReviewNote).toBeNull();
        expect(d.weaverReviewedByAgentId).toBeNull();
      }
    });

    it('wakes the weaver at creation for a worker-raised plan, merge or action approval, naming the decision (VS-361)', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      for (const kind of ['plan_approval', 'merge_approval', 'action_approval'] as const) {
        const d = decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: workerId, correlationKey: `${kind}:${t.id}` });
        const call = wake.calls.find((c) => c.agentId === h.conductorId && (c.input.payload as { decisionId?: string })?.decisionId === d.id);
        expect(call).toBeDefined();
        expect(call!.input.source).toBe('system');
        expect(call!.input.reason).toBe(`decision ${kind} awaits your review`);
        expect(call!.input.payload).toMatchObject({ decisionId: d.id, ticketId: t.id });
        expect(call!.input.idempotencyKey).toBe(`decision-review:${d.id}`);
      }
    });

    it('does not review-wake a review-carrying decision the weaver raised itself (VS-361)', () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan', askedByAgentId: h.conductorId });
      expect(wake.calls.some((c) => c.input.reason === 'decision plan_approval awaits your review' && (c.input.payload as { decisionId?: string })?.decisionId === d.id)).toBe(false);
    });

    it('leaves kinds with no weaver review on their existing wake path (VS-361)', () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      for (const kind of ['question', 'hire_approval', 'retry_approval'] as const) {
        const d = decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: workerId, correlationKey: `${kind}:${newId()}` });
        expect(wake.calls.some((c) => String(c.input.reason).includes('awaits your review') && (c.input.payload as { decisionId?: string })?.decisionId === d.id)).toBe(false);
      }
    });

    it('coalesces two review cards created within a second into one turn (VS-361)', async () => {
      const { createWakeService } = await import('../wake/index.js');
      const t = ticket();
      const workerId = h.addWorker(t.id);
      const realWake = createWakeService(h.ctx, h.deps);
      realWake.cancelForAgent(h.conductorId, 'test: clear queued wakes before the burst');
      h.services.wake = realWake as never;
      const a = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'A', askedByAgentId: workerId, correlationKey: `plan_approval:${t.id}` });
      const b = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'B', askedByAgentId: workerId, correlationKey: `merge_approval:${t.id}` });
      const rows = h.db.all<{ id: string; status: string }>(
        "SELECT id, status FROM wakeups WHERE agent_id = ? AND idempotency_key LIKE 'decision-review:%' ORDER BY created_at",
        [h.conductorId],
      );
      expect(rows.filter((r) => r.status === 'queued')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'coalesced')).toHaveLength(1);
      const queuedId = rows.find((r) => r.status === 'queued')!.id;
      const queued = h.db.get<{ payload: { decisionId?: string; bundle?: Array<{ payload?: { decisionId?: string } }> } }>('SELECT * FROM wakeups WHERE id = ?', [queuedId])!;
      const ids = [queued.payload.decisionId, ...(queued.payload.bundle ?? []).map((x) => x.payload?.decisionId)];
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
    });

    it('lets the conductor mark looked and concerns on plan, merge and action, open or answered', async () => {
      const t = ticket();
      const openPlan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const looked = await decisions.review(conductor(), openPlan.id, { status: 'looked', note: '  plan matches the ticket  ' });
      expect(looked.weaverReviewStatus).toBe('looked');
      expect(looked.weaverReviewedAt).toBeTruthy();
      expect(looked.weaverReviewNote).toBe('plan matches the ticket');
      expect(looked.weaverReviewedByAgentId).toBe(h.conductorId);

      const merge = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge', correlationKey: `merge:${t.id}` });
      const concerns = await decisions.review(conductor(), merge.id, { status: 'concerns', note: '  CI is red  ' });
      expect(concerns.weaverReviewStatus).toBe('concerns');
      expect(concerns.weaverReviewNote).toBe('CI is red');

      const action = decisions.create(AGENT, { ticketId: t.id, kind: 'action_approval', title: 'Action', correlationKey: `action:${t.id}` });
      await markLooked(action.id, 'ran the action steps');
      await decisions.answer(HUMAN, action.id, { key: 'approve' });
      const after = await decisions.review(conductor(), action.id, { status: 'looked', note: 'ran the action steps' });
      expect(after.weaverReviewStatus).toBe('looked');
      expect(after.status).toBe('answered');
    });

    it('refuses a clean mark without a note, exactly as it refuses a noteless concern (VS-234)', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.review(conductor(), d.id, { status: 'looked' })).rejects.toThrow(/looked requires a note/);
      await expect(decisions.review(conductor(), d.id, { status: 'looked', note: '   ' })).rejects.toThrow(/looked requires a note/);
      await expect(decisions.review(conductor(), d.id, { status: 'looked', note: 'x'.repeat(501) })).rejects.toThrow(/500/);
      expect(decisions.get(d.id).weaverReviewStatus).toBe('unseen');
      expect(decisions.get(d.id).weaverReviewNote).toBeNull();
    });

    it('refuses concerns without a note and a note over 500 characters', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.review(conductor(), d.id, { status: 'concerns' })).rejects.toThrow(/requires a note/);
      await expect(decisions.review(conductor(), d.id, { status: 'concerns', note: '   ' })).rejects.toThrow(/requires a note/);
      await expect(decisions.review(conductor(), d.id, { status: 'concerns', note: 'x'.repeat(501) })).rejects.toThrow(/500/);
      expect(decisions.get(d.id).weaverReviewStatus).toBe('unseen');
    });

    it('refuses a worker actor and leaves the row unchanged', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.review(AGENT, d.id, { status: 'looked' })).rejects.toMatchObject({ code: 'forbidden' });
      expect(decisions.get(d.id).weaverReviewStatus).toBe('unseen');
      await expect(decisions.review(HUMAN, d.id, { status: 'looked' })).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('refuses excluded kinds and terminal statuses', async () => {
      const t = ticket();
      const q = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Q?' });
      await expect(decisions.review(conductor(), q.id, { status: 'looked' })).rejects.toMatchObject({ code: 'validation' });

      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan', correlationKey: `plan2:${t.id}` });
      decisions.withdraw(HUMAN, plan.id, 'never mind');
      await expect(decisions.review(conductor(), plan.id, { status: 'looked' })).rejects.toMatchObject({ code: 'wrong_status', details: { status: 'withdrawn' } });
    });

    it('a clean mark replaces a previous concern note and each mark sets a fresh reviewedAt (VS-234)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-11T03:00:00.000Z'));
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const first = await decisions.review(conductor(), d.id, { status: 'concerns', note: 'split the migration' });
      expect(first.weaverReviewNote).toBe('split the migration');
      vi.setSystemTime(new Date('2026-09-11T03:00:01.000Z'));
      const second = await decisions.review(conductor(), d.id, { status: 'looked', note: 'migration was split, all clear now' });
      expect(second.weaverReviewStatus).toBe('looked');
      expect(second.weaverReviewNote).toBe('migration was split, all clear now');
      expect(second.weaverReviewedAt! > first.weaverReviewedAt!).toBe(true);
      vi.useRealTimers();
    });

    it('records the delivery head the review was made against, and null without one (VS-365)', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
      const head = 'deadbeef'.repeat(5);
      const withHead = await decisions.review(conductor(), d.id, { status: 'concerns', note: 'the retry loop can hang', reviewedHead: head });
      expect(withHead.weaverReviewedHeadSha).toBe(head);
      expect(decisions.get(d.id).weaverReviewedHeadSha).toBe(head);

      const noHead = await decisions.review(conductor(), d.id, { status: 'looked', note: 'all clear now' });
      expect(noHead.weaverReviewedHeadSha).toBeNull();
    });

    it('stores an optional waiting statement on the mark (VS-481)', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
      const marked = await decisions.review(conductor(), d.id, {
        status: 'looked', note: 'nothing to object to', waitingOn: 'waiting for runner CI on 414b329d',
      });
      expect(marked.weaverReviewWaitingOn).toBe('waiting for runner CI on 414b329d');
      expect(decisions.get(d.id).weaverReviewWaitingOn).toBe('waiting for runner CI on 414b329d');
    });

    it('clears the waiting statement on a later mark that omits it (VS-481)', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
      await decisions.review(conductor(), d.id, { status: 'concerns', note: 'needs a revision', waitingOn: 'a worker revision' });
      const again = await decisions.review(conductor(), d.id, { status: 'looked', note: 'fixed now' });
      expect(again.weaverReviewWaitingOn).toBeNull();
    });

    it('refuses a waiting statement longer than the cap and changes nothing (VS-481)', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
      await decisions.review(conductor(), d.id, { status: 'looked', note: 'clean', waitingOn: 'on CI' });
      await expect(decisions.review(conductor(), d.id, { status: 'looked', note: 'clean', waitingOn: 'y'.repeat(121) }))
        .rejects.toMatchObject({ code: 'validation' });
      expect(decisions.get(d.id).weaverReviewWaitingOn).toBe('on CI');
    });

    it('emits decision.updated with the full Decision and enqueues no wake', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const before = wake.calls.length;
      const marked = await decisions.review(conductor(), d.id, { status: 'looked', note: 'plan covers the scope' });
      await new Promise((r) => setImmediate(r));
      expect(h.events.some((e) => e.type === 'decision.updated' && (e.payload as { id: string }).id === marked.id)).toBe(true);
      const ev = h.events.find((e) => e.type === 'decision.updated')!;
      expect(ev.payload).toMatchObject({
        id: marked.id,
        weaverReviewStatus: 'looked',
        weaverReviewedByAgentId: h.conductorId,
      });
      expect(wake.calls.length).toBe(before);
    });

    it('answers a looked plan_approval and a concerns merge_approval on the same path', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed', workerId });
      const plan = decisions.create(AGENT, {
        ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan', askedByAgentId: workerId,
        options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
      });
      // VS-281: an unseen plan is held, so the normal path marks it looked first.
      expect(plan.weaverReviewStatus).toBe('unseen');
      markLooked(plan.id, 'plan matches the ticket');
      await decisions.answer(HUMAN, plan.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('approved');
      expect(decisions.get(plan.id)).toMatchObject({
        answerKey: 'approve',
        weaverReviewStatus: 'looked',
        weaverReviewNote: 'plan matches the ticket',
      });

      const t2 = ticket({ title: 'Merge this' });
      const worker2 = h.addWorker(t2.id);
      tickets.addWorkProduct(AGENT, t2.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
      h.db.update('tickets', t2.id, { status: 'in_review', workerId: worker2 });
      const merge = decisions.create(AGENT, {
        ticketId: t2.id, kind: 'merge_approval', title: 'Merge?', askedByAgentId: worker2,
        options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Changes' }],
      });
      const flagged = await decisions.review(conductor(), merge.id, { status: 'concerns', note: 'screenshot is cropped' });
      expect(flagged.weaverReviewStatus).toBe('concerns');
      // VS-266: a concern holds the approving answer — overriding it is required to still take this path.
      await decisions.answer(HUMAN, merge.id, { key: 'approve', overrideHold: true, overrideReason: 'merging anyway, the screenshot is unrelated' });
      const answered = decisions.get(merge.id);
      expect(answered.answerKey).toBe('approve');
      expect(answered.weaverReviewStatus).toBe('concerns');
      expect(answered.weaverReviewNote).toBe('screenshot is cropped');
      expect(tickets.get(t2.id).status).toBe('merging');
    });
  });

  describe('holding approval on a concern (VS-266)', () => {
    const conductor = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' });

    it('refuses to approve a plan_approval the conductor marked concerns, naming what is being waited on', async () => {
      const t = ticket();
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'the migration needs splitting' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve' })).rejects.toMatchObject({
        code: 'revision_pending',
        details: { weaverReviewNote: 'the migration needs splitting' },
      });
      expect(decisions.get(plan.id).status).toBe('open');
    });

    it('refuses to approve a merge_approval the conductor marked concerns', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'in_review' });
      const merge = decisions.create(AGENT, {
        ticketId: t.id, kind: 'merge_approval', title: 'Merge?',
        options: [{ key: 'approve', label: 'Approve merge' }, { key: 'changes', label: 'Request changes' }],
      });
      decisions.review(conductor(), merge.id, { status: 'concerns', note: 'CI is flaky, re-run first' });
      await expect(decisions.answer(HUMAN, merge.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });
      expect(decisions.get(merge.id).status).toBe('open');
    });

    it('never blocks a non-approving answer, whatever the review state', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed', workerId });
      const plan = decisions.create(AGENT, {
        ticketId: t.id, kind: 'plan_approval', title: 'Plan', askedByAgentId: workerId,
        options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
      });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'needs work' });
      await decisions.answer(HUMAN, plan.id, { key: 'revise', text: 'please split it' });
      expect(decisions.get(plan.id).status).toBe('answered');
      expect(tickets.get(t.id).status).toBe('proposing');

      const t2 = ticket({ title: 'Merge this too' });
      const worker2 = h.addWorker(t2.id);
      h.db.update('tickets', t2.id, { status: 'in_review', workerId: worker2 });
      const merge = decisions.create(AGENT, {
        ticketId: t2.id, kind: 'merge_approval', title: 'Merge?', askedByAgentId: worker2,
        options: [{ key: 'approve', label: 'Approve merge' }, { key: 'changes', label: 'Request changes' }],
      });
      decisions.review(conductor(), merge.id, { status: 'concerns', note: 'flaky test' });
      await decisions.answer(HUMAN, merge.id, { key: 'changes', text: 'please fix' });
      expect(decisions.get(merge.id).status).toBe('answered');
      expect(tickets.get(t2.id).status).toBe('in_progress');
    });

    it('lets a human override the hold, and records who, when and why', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'needs work' });
      await decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: 'acceptable risk, ship it' });
      expect(decisions.get(plan.id).status).toBe('answered');
      expect(tickets.get(t.id).status).toBe('approved');

      const rows = h.db.all<{ actorId: string; actorKind: string; details: Record<string, unknown> }>(
        "SELECT actor_id, actor_kind, details_json FROM activity WHERE action = 'decision.hold_overridden'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: 'victor', actorKind: 'human', details: { reason: 'acceptable risk, ship it' } });
      expect(tickets.comments(t.id).some((c) => c.body.includes('acceptable risk, ship it'))).toBe(true);
    });

    it('refuses the override without a stated reason, or with overrideHold unset', async () => {
      const t = ticket();
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'needs work' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve', overrideReason: 'no flag set' })).rejects.toMatchObject({ code: 'revision_pending' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: '   ' })).rejects.toMatchObject({ code: 'revision_pending' });
      expect(decisions.get(plan.id).status).toBe('open');
      expect(h.db.all("SELECT id FROM activity WHERE action = 'decision.hold_overridden'")).toHaveLength(0);
    });

    it('ignores an override on a decision that is not held', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      // VS-281: a `looked` card is genuinely not held, which is the case this test is about.
      markLooked(plan.id, 'clean');
      await decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: 'not needed here' });
      expect(tickets.get(t.id).status).toBe('approved');
      expect(h.db.all("SELECT id FROM activity WHERE action = 'decision.hold_overridden'")).toHaveLength(0);
      expect(tickets.comments(t.id).some((c) => c.body.includes('not needed here'))).toBe(false);
    });

    it('a worker that never revises does not strand the human: the override needs no live worker', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed', workerId });
      h.db.update('agents', workerId, { status: 'retired' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan', askedByAgentId: workerId });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'the worker went quiet' });
      await decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: 'worker retired, proceeding without a revision' });
      expect(tickets.get(t.id).status).toBe('approved');
    });

    it('lifts the hold when a plan sent back for revision is re-proposed: the fresh decision starts unseen', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposing' });
      await tickets.transition(AGENT, t.id, { to: 'proposed' });
      const firstPlan = decisions.list({ ticketId: t.id, status: ['open'] }).find((d) => d.kind === 'plan_approval')!;
      decisions.review(conductor(), firstPlan.id, { status: 'concerns', note: 'needs another pass' });
      await expect(decisions.answer(HUMAN, firstPlan.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });

      await decisions.answer(HUMAN, firstPlan.id, { key: 'revise', text: 'go again' });
      expect(tickets.get(t.id).status).toBe('proposing');
      expect(decisions.get(firstPlan.id).status).toBe('answered');

      await tickets.transition(AGENT, t.id, { to: 'proposed' });
      const secondPlan = decisions.list({ ticketId: t.id, status: ['open'] }).find((d) => d.kind === 'plan_approval')!;
      expect(secondPlan.id).not.toBe(firstPlan.id);
      // VS-281: the fresh decision is unseen, so it now carries the unreviewed hold too; marking it
      // looked is the normal path and still proves the prior concern no longer holds it.
      expect(secondPlan.weaverReviewStatus).toBe('unseen');
      markLooked(secondPlan.id, 'second pass is clean');
      await decisions.answer(HUMAN, secondPlan.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('approved');
    });

    it('lifts the hold when a merge approval held by a concern is redelivered: the fresh decision starts unseen', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'in_progress' });
      tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
      await tickets.transition(AGENT, t.id, { to: 'in_review' });
      const firstMerge = decisions.list({ ticketId: t.id, status: ['open'] }).find((d) => d.kind === 'merge_approval')!;
      decisions.review(conductor(), firstMerge.id, { status: 'concerns', note: 'the diff still has the debug log' });
      await expect(decisions.answer(HUMAN, firstMerge.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });

      await decisions.answer(HUMAN, firstMerge.id, { key: 'changes', text: 'strip the debug log' });
      expect(tickets.get(t.id).status).toBe('in_progress');
      expect(decisions.get(firstMerge.id).status).toBe('answered');

      await tickets.transition(AGENT, t.id, { to: 'in_review' });
      const secondMerge = decisions.list({ ticketId: t.id, status: ['open'] }).find((d) => d.kind === 'merge_approval')!;
      expect(secondMerge.id).not.toBe(firstMerge.id);
      expect(secondMerge.weaverReviewStatus).toBe('unseen');
      markLooked(secondMerge.id, 'debug log is gone');
      await decisions.answer(HUMAN, secondMerge.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('merging');
    });

    it('does not lift its own hold when marked concerns again with no revision cycle in between', async () => {
      const t = ticket();
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'first pass' });
      decisions.review(conductor(), plan.id, { status: 'concerns', note: 'still not right' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });
      expect(decisions.get(plan.id).status).toBe('open');
    });
  });

  describe('holding approval before the weaver reviews (VS-281)', () => {
    it('refuses an approving answer on an open unseen plan, merge and action approval, naming the pending review', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve' })).rejects.toMatchObject({
        code: 'revision_pending', details: { weaverReviewStatus: 'unseen' },
      });
      expect(decisions.get(plan.id).status).toBe('open');
      expect(tickets.get(t.id).status).toBe('proposed');

      const t2 = ticket({ title: 'Merge?' });
      h.db.update('tickets', t2.id, { status: 'in_review' });
      const merge = decisions.create(AGENT, {
        ticketId: t2.id, kind: 'merge_approval', title: 'Merge?',
        options: [{ key: 'approve', label: 'Approve merge' }, { key: 'changes', label: 'Request changes' }],
      });
      await expect(decisions.answer(HUMAN, merge.id, { key: 'approve' })).rejects.toMatchObject({
        code: 'revision_pending', details: { weaverReviewStatus: 'unseen' },
      });
      expect(decisions.get(merge.id).status).toBe('open');
      expect(tickets.get(t2.id).status).toBe('in_review');

      const t3 = ticket({ kind: 'operational', title: 'Restart the daemon' });
      h.db.update('tickets', t3.id, { status: 'in_progress' });
      const action = decisions.create(AGENT, {
        ticketId: t3.id, kind: 'action_approval', owner: 'human', title: 'Action',
        options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
      });
      await expect(decisions.answer(HUMAN, action.id, { key: 'approve' })).rejects.toMatchObject({
        code: 'revision_pending', details: { weaverReviewStatus: 'unseen' },
      });
      expect(decisions.get(action.id).status).toBe('open');
      expect(tickets.get(t3.id).status).toBe('in_progress');
    });

    it('keeps the concern hold, and lets a looked card approve freely (VS-266 unchanged)', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const flagged = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Flagged' });
      decisions.review(conductor(), flagged.id, { status: 'concerns', note: 'split the migration' });
      await expect(decisions.answer(HUMAN, flagged.id, { key: 'approve' })).rejects.toMatchObject({
        code: 'revision_pending', details: { weaverReviewStatus: 'concerns', weaverReviewNote: 'split the migration' },
      });
      expect(decisions.get(flagged.id).status).toBe('open');

      const t2 = ticket({ title: 'Clean' });
      h.db.update('tickets', t2.id, { status: 'proposed' });
      const clean = decisions.create(AGENT, { ticketId: t2.id, kind: 'plan_approval', title: 'Clean' });
      markLooked(clean.id, 'plan matches the ticket');
      await decisions.answer(HUMAN, clean.id, { key: 'approve' });
      expect(tickets.get(t2.id).status).toBe('approved');
    });

    it('holds the system actor on an unseen card too, so YOLO never skips the review (VS-474)', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      // VS-474 replaced VS-281's system-actor exemption: the daemon's own grant is held while the card
      // is unseen, exactly like a human's, so a YOLO approval cannot land before the weaver reviews it.
      await expect(decisions.answer(SYSTEM, plan.id, { key: 'approve', text: 'Auto-approved by YOLO mode' }))
        .rejects.toMatchObject({ code: 'revision_pending', details: { weaverReviewStatus: 'unseen' } });
      expect(tickets.get(t.id).status).toBe('proposed');

      await markLooked(plan.id, 'plan is sound');
      await decisions.answer(SYSTEM, plan.id, { key: 'approve', text: 'Auto-approved by YOLO mode' });
      expect(tickets.get(t.id).status).toBe('approved');

      const t2 = ticket({ title: 'Merge?' });
      h.db.update('tickets', t2.id, { status: 'in_review' });
      const merge = decisions.create(AGENT, {
        ticketId: t2.id, kind: 'merge_approval', title: 'Merge?',
        options: [{ key: 'approve', label: 'Approve merge' }, { key: 'changes', label: 'Request changes' }],
      });
      await expect(decisions.answer(SYSTEM, merge.id, { key: 'approve', text: 'Auto-approved by YOLO mode' }))
        .rejects.toMatchObject({ code: 'revision_pending' });
      expect(tickets.get(t2.id).status).toBe('in_review');
    });

    it('never refuses a non-approving answer, for unseen, looked and concerns', async () => {
      for (const state of ['unseen', 'looked', 'concerns'] as const) {
        const t = ticket({ title: `Plan ${state}` });
        h.db.update('tickets', t.id, { status: 'proposed' });
        const plan = decisions.create(AGENT, {
          ticketId: t.id, kind: 'plan_approval', title: 'Plan',
          options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
        });
        if (state === 'looked') markLooked(plan.id, 'clean');
        if (state === 'concerns') decisions.review(conductor(), plan.id, { status: 'concerns', note: 'nope' });
        await decisions.answer(HUMAN, plan.id, { key: 'revise', text: 'again' });
        expect(decisions.get(plan.id).status, state).toBe('answered');
      }

      const ta = ticket({ kind: 'operational', title: 'Action reject' });
      h.db.update('tickets', ta.id, { status: 'in_progress' });
      const action = decisions.create(AGENT, {
        ticketId: ta.id, kind: 'action_approval', owner: 'human', title: 'Action',
        options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
      });
      await decisions.answer(HUMAN, action.id, { key: 'reject', text: 'no' });
      expect(tickets.get(ta.id).status).toBe('cancelled');

      const tm = ticket({ title: 'Merge changes' });
      h.db.update('tickets', tm.id, { status: 'in_review' });
      const merge = decisions.create(AGENT, {
        ticketId: tm.id, kind: 'merge_approval', title: 'Merge?',
        options: [{ key: 'approve', label: 'Approve merge' }, { key: 'changes', label: 'Request changes' }],
      });
      await decisions.answer(HUMAN, merge.id, { key: 'changes', text: 'please fix' });
      expect(tickets.get(tm.id).status).toBe('in_progress');
    });

    it('lets a human override the unreviewed hold, recording the reason and the pending review', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: 'read it myself, ship it' });
      expect(tickets.get(t.id).status).toBe('approved');

      const rows = h.db.all<{ actorId: string; actorKind: string; details: Record<string, unknown> }>(
        "SELECT actor_id, actor_kind, details_json FROM activity WHERE action = 'decision.hold_overridden'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: 'victor', actorKind: 'human', details: { reason: 'read it myself, ship it', weaverReviewStatus: 'unseen' } });
      expect(tickets.comments(t.id).some((c) => c.body.includes('pending review') && c.body.includes('read it myself, ship it'))).toBe(true);
    });

    it('still refuses the unreviewed override without a stated reason', async () => {
      const t = ticket();
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve', overrideReason: 'no flag set' })).rejects.toMatchObject({ code: 'revision_pending' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: '   ' })).rejects.toMatchObject({ code: 'revision_pending' });
      expect(decisions.get(plan.id).status).toBe('open');
      expect(h.db.all("SELECT id FROM activity WHERE action = 'decision.hold_overridden'")).toHaveLength(0);
    });

    it('lifts the unreviewed hold when the weaver marks the card looked', async () => {
      const t = ticket();
      h.db.update('tickets', t.id, { status: 'proposed' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      await expect(decisions.answer(HUMAN, plan.id, { key: 'approve' })).rejects.toMatchObject({ code: 'revision_pending' });
      markLooked(plan.id, 'reviewed the plan');
      await decisions.answer(HUMAN, plan.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('approved');
      expect(decisions.get(plan.id).weaverReviewStatus).toBe('looked');
    });

    it('lets the human override with the weaver paused and the worker retired', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed', workerId });
      h.db.update('agents', workerId, { status: 'retired' });
      h.db.update('agents', h.conductorId, { status: 'paused', pauseReason: 'provider_quota: waiting for reset' });
      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan', askedByAgentId: workerId });
      await decisions.answer(HUMAN, plan.id, { key: 'approve', overrideHold: true, overrideReason: 'weaver is out, proceeding' });
      expect(tickets.get(t.id).status).toBe('approved');
    });
  });

  // VS-310: the weaver may record a human's prose answer to an askable, human-owned decision,
  // naming the message it came from. Every approval stays out of reach; only the weaver may relay.
  describe('relayed answers (VS-310)', () => {
    const WEAVER = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-weaver' });
    const askedByWeaver = () => decisions.create(WEAVER(), {
      kind: 'question', title: 'Which store?', askedByAgentId: h.conductorId, correlationKey: newId(),
      options: [{ key: 'sqlite', label: 'SQLite' }],
    });
    const otherWorkspace = () => {
      const id = newId();
      h.db.insert('workspaces', { id, slug: `other-${id.slice(0, 6)}`, name: 'Other', ticketPrefix: 'OTH', rootPath: '/tmp/other', createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' });
      return id;
    };
    const message = (over: Partial<{ workspaceId: string; direction: 'inbound' | 'outbound'; authorKind: string; body: string }> = {}) => {
      const channelId = newId();
      h.db.insert('channels', { id: channelId, workspaceId: over.workspaceId ?? h.workspaceId, kind: channelId, configJson: {}, status: 'active' });
      const threadId = newId();
      h.db.insert('channel_threads', { id: threadId, channelId, agentId: h.conductorId, createdAt: '2026-09-12T00:00:00.000Z' });
      const id = newId();
      h.db.insert('thread_messages', {
        id, threadId, direction: over.direction ?? 'inbound', authorKind: over.authorKind ?? 'human', authorId: 'victor',
        body: over.body ?? 'go with sqlite', createdAt: '2026-09-12T00:00:01.000Z',
      });
      return id;
    };

    it('stores the words verbatim, marking the weaver as writer and the human as author, linked to the message', async () => {
      const d = askedByWeaver();
      const msg = message({ body: 'go with sqlite, and keep the tests' });
      const answered = await decisions.answer(WEAVER(), d.id, { text: 'go with sqlite, and keep the tests', relayFromMessageId: msg });
      expect(answered.status).toBe('answered');
      expect(answered.answerText).toBe('go with sqlite, and keep the tests');
      expect(answered.answeredByKind).toBe('agent');
      expect(answered.answeredById).toBe(h.conductorId);
      expect(answered.answerAuthorKind).toBe('human');
      expect(answered.relayedFromMessageId).toBe(msg);
    });

    it('stores a mapped option key alongside the verbatim words', async () => {
      const d = askedByWeaver();
      const answered = await decisions.answer(WEAVER(), d.id, { key: 'sqlite', text: 'yes, sqlite please', relayFromMessageId: message() });
      expect(answered.answerKey).toBe('sqlite');
      expect(answered.answerText).toBe('yes, sqlite please');
    });

    it('leaves a direct answer carrying no relay provenance', async () => {
      const d = decisions.create(AGENT, { kind: 'question', title: 'q', options: [{ key: 'a', label: 'A' }] });
      const answered = await decisions.answer(HUMAN, d.id, { key: 'a' });
      expect(answered.answeredByKind).toBe('human');
      expect(answered.answerAuthorKind).toBeNull();
      expect(answered.relayedFromMessageId).toBeNull();
    });

    it('wakes the asker and emits decision.answered', async () => {
      const d = askedByWeaver();
      const msg = message();
      await decisions.answer(WEAVER(), d.id, { text: 'go with sqlite', relayFromMessageId: msg });
      await new Promise((r) => setImmediate(r));
      const w = wake.calls.find((c) => c.input.source === 'decision_answered');
      expect(w?.agentId).toBe(h.conductorId);
      expect(w?.input.payload).toMatchObject({ decisionId: d.id, answer: { text: 'go with sqlite' } });
      expect(h.events.some((e) => e.type === 'decision.answered')).toBe(true);
    });

    it('refuses an option key the decision does not offer', async () => {
      const d = askedByWeaver();
      await expect(decisions.answer(WEAVER(), d.id, { key: 'nope', relayFromMessageId: message() })).rejects.toMatchObject({ code: 'validation' });
      expect(decisions.get(d.id).status).toBe('open');
    });

    it('refuses a message that does not exist, from another workspace, outbound, or not the human\'s, leaving the card open', async () => {
      const d = askedByWeaver();
      await expect(decisions.answer(WEAVER(), d.id, { text: 'x', relayFromMessageId: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
      await expect(decisions.answer(WEAVER(), d.id, { text: 'x', relayFromMessageId: message({ workspaceId: otherWorkspace() }) })).rejects.toMatchObject({ code: 'not_found' });
      await expect(decisions.answer(WEAVER(), d.id, { text: 'x', relayFromMessageId: message({ direction: 'outbound' }) })).rejects.toMatchObject({ code: 'validation' });
      await expect(decisions.answer(WEAVER(), d.id, { text: 'x', relayFromMessageId: message({ authorKind: 'agent' }) })).rejects.toMatchObject({ code: 'validation' });
      const after = decisions.get(d.id);
      expect(after.status).toBe('open');
      expect(after.answeredAt).toBeNull();
      expect(after.relayedFromMessageId).toBeNull();
    });

    it('refuses a relay on a decision the weaver owns', async () => {
      const workerId = h.addWorker(null);
      const d = decisions.create(WEAVER(), { kind: 'question', title: 'worker question', askedByAgentId: workerId, correlationKey: newId() });
      expect(d.owner).toBe('weaver');
      await expect(decisions.answer(WEAVER(), d.id, { text: 'x', relayFromMessageId: message() })).rejects.toMatchObject({ code: 'validation' });
      expect(decisions.get(d.id).status).toBe('open');
    });

    it('refuses a relay from any actor other than the workspace weaver', async () => {
      const d = askedByWeaver();
      const msg = message();
      await expect(decisions.answer(HUMAN, d.id, { text: 'x', relayFromMessageId: msg })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(decisions.answer({ kind: 'agent', id: 'some-worker' }, d.id, { text: 'x', relayFromMessageId: msg })).rejects.toMatchObject({ code: 'forbidden' });
      expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(d.id).relayedFromMessageId).toBeNull();
    });
  });
});
