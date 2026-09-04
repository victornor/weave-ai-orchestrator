import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@openconductor/db';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from '../tickets/service.js';
import { createDecisionsService } from './service.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const AGENT: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };

describe('decisions', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let decisions: DecisionsService;
  let wake: ReturnType<typeof fakeWake>;
  let knowledge: { appendDecision: ReturnType<typeof vi.fn> };
  let roles: { activate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    knowledge = { appendDecision: vi.fn() };
    roles = { activate: vi.fn(async () => ({ id: 'role' })) };
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
    expect(decisions.create(AGENT, { ticketId: t2.id, kind: 'plan_approval', title: 'y' }).owner).toBe('conductor');
    expect(decisions.create(AGENT, { kind: 'gate_finding', title: 'z' }).owner).toBe('conductor');
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

  it('rejects an unknown option and a second answer', async () => {
    const t = ticket();
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'q', options: [{ key: 'a', label: 'A' }] });
    await expect(decisions.answer(HUMAN, d.id, { key: 'nope' })).rejects.toMatchObject({ code: 'validation' });
    await decisions.answer(HUMAN, d.id, { key: 'a' });
    await expect(decisions.answer(HUMAN, d.id, { key: 'a' })).rejects.toMatchObject({ code: 'wrong_status' });
  });

  describe('plan approval side effects', () => {
    const proposed = () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed' });
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan', askedByAgentId: workerId });
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

  it('merge approval approve moves the ticket to merging and wakes the worker', async () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.update('tickets', t.id, { status: 'in_review' });
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?', askedByAgentId: workerId });
    await decisions.answer(HUMAN, d.id, { key: 'approve' });
    expect(tickets.get(t.id).status).toBe('merging');
    expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'merge_approved')).toBe(true);
  });

  it('merge approval changes sends the ticket back to in_progress', async () => {
    const t = ticket();
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'u' });
    h.db.update('tickets', t.id, { status: 'in_review' });
    const d = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge?' });
    await decisions.answer(HUMAN, d.id, { key: 'changes', text: 'tests missing' });
    expect(tickets.get(t.id).status).toBe('in_progress');
  });

  it('hire approval activates the role, honouring a runtime switch in the answer key', async () => {
    const d = decisions.create(HUMAN, { kind: 'hire_approval', title: 'Hire a backend engineer', target: { roleId: h.roleId } });
    await decisions.answer(HUMAN, d.id, { key: 'runtime:codex' });
    expect(roles.activate).toHaveBeenCalledWith(HUMAN, h.roleId, { runtime: 'codex' });

    const d2 = decisions.create(HUMAN, { kind: 'hire_approval', title: 'Hire again', target: { roleId: h.roleId }, correlationKey: 'hire:2' });
    await decisions.answer(HUMAN, d2.id, { key: 'approve' });
    expect(roles.activate).toHaveBeenLastCalledWith(HUMAN, h.roleId, undefined);
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

  it('creates workspace-level decisions without a ticket', () => {
    const d = decisions.create(HUMAN, { kind: 'approval', title: 'Add a project?' });
    expect(d.ticketId).toBeNull();
    expect(decisions.get(d.id).correlationKey).toBe('approval:workspace');
    expect(newId()).toBeTruthy();
  });
});
