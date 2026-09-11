import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@agent-conductor/db';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from '../tickets/service.js';
import { createDecisionsService } from './service.js';
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

  it('resolves a worker-asked question or concern to the conductor, and wakes it immediately', () => {
    const t = ticket();
    const workerId = h.addWorker(t.id);
    for (const kind of ['question', 'concern'] as const) {
      const d = decisions.create(AGENT, { ticketId: t.id, kind, title: kind, askedByAgentId: workerId, correlationKey: `${kind}:${newId()}` });
      expect(d.owner).toBe('conductor');
      const w = wake.calls.find((c) => c.agentId === h.conductorId && (c.input.payload as { decisionId?: string })?.decisionId === d.id);
      expect(w).toBeDefined();
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
    expect(decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'x', askedByAgentId: workerId, correlationKey: newId() }).owner).toBe('conductor');
    expect(decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'y', askedByAgentId: h.conductorId, correlationKey: newId() }).owner).toBe('conductor');
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
    expect(decisions.get(d.id).correlationKey).toBe('approval:workspace');
    expect(newId()).toBeTruthy();
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
        expect(d.conductorReviewStatus).toBe('unseen');
        expect(d.conductorReviewedAt).toBeNull();
        expect(d.conductorReviewNote).toBeNull();
        expect(d.conductorReviewedByAgentId).toBeNull();
      }
    });

    it('lets the conductor mark looked and concerns on plan, merge and action, open or answered', async () => {
      const t = ticket();
      const openPlan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const looked = decisions.review(conductor(), openPlan.id, { status: 'looked', note: '  plan matches the ticket  ' });
      expect(looked.conductorReviewStatus).toBe('looked');
      expect(looked.conductorReviewedAt).toBeTruthy();
      expect(looked.conductorReviewNote).toBe('plan matches the ticket');
      expect(looked.conductorReviewedByAgentId).toBe(h.conductorId);

      const merge = decisions.create(AGENT, { ticketId: t.id, kind: 'merge_approval', title: 'Merge', correlationKey: `merge:${t.id}` });
      const concerns = decisions.review(conductor(), merge.id, { status: 'concerns', note: '  CI is red  ' });
      expect(concerns.conductorReviewStatus).toBe('concerns');
      expect(concerns.conductorReviewNote).toBe('CI is red');

      const action = decisions.create(AGENT, { ticketId: t.id, kind: 'action_approval', title: 'Action', correlationKey: `action:${t.id}` });
      await decisions.answer(HUMAN, action.id, { key: 'approve' });
      const after = decisions.review(conductor(), action.id, { status: 'looked', note: 'ran the action steps' });
      expect(after.conductorReviewStatus).toBe('looked');
      expect(after.status).toBe('answered');
    });

    it('refuses a clean mark without a note, exactly as it refuses a noteless concern (VS-234)', () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      expect(() => decisions.review(conductor(), d.id, { status: 'looked' })).toThrow(/looked requires a note/);
      expect(() => decisions.review(conductor(), d.id, { status: 'looked', note: '   ' })).toThrow(/looked requires a note/);
      expect(() => decisions.review(conductor(), d.id, { status: 'looked', note: 'x'.repeat(501) })).toThrow(/500/);
      expect(decisions.get(d.id).conductorReviewStatus).toBe('unseen');
      expect(decisions.get(d.id).conductorReviewNote).toBeNull();
    });

    it('refuses concerns without a note and a note over 500 characters', () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      expect(() => decisions.review(conductor(), d.id, { status: 'concerns' })).toThrow(/requires a note/);
      expect(() => decisions.review(conductor(), d.id, { status: 'concerns', note: '   ' })).toThrow(/requires a note/);
      expect(() => decisions.review(conductor(), d.id, { status: 'concerns', note: 'x'.repeat(501) })).toThrow(/500/);
      expect(decisions.get(d.id).conductorReviewStatus).toBe('unseen');
    });

    it('refuses a worker actor and leaves the row unchanged', () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      try {
        decisions.review(AGENT, d.id, { status: 'looked' });
        expect.unreachable('worker must be forbidden');
      } catch (e) {
        expect(e).toMatchObject({ code: 'forbidden' });
      }
      expect(decisions.get(d.id).conductorReviewStatus).toBe('unseen');
      try {
        decisions.review(HUMAN, d.id, { status: 'looked' });
        expect.unreachable('human must be forbidden');
      } catch (e) {
        expect(e).toMatchObject({ code: 'forbidden' });
      }
    });

    it('refuses excluded kinds and terminal statuses', async () => {
      const t = ticket();
      const q = decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Q?' });
      try {
        decisions.review(conductor(), q.id, { status: 'looked' });
        expect.unreachable('question must be validation');
      } catch (e) {
        expect(e).toMatchObject({ code: 'validation' });
      }

      const plan = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan', correlationKey: `plan2:${t.id}` });
      decisions.withdraw(HUMAN, plan.id, 'never mind');
      try {
        decisions.review(conductor(), plan.id, { status: 'looked' });
        expect.unreachable('withdrawn must be wrong_status');
      } catch (e) {
        expect(e).toMatchObject({ code: 'wrong_status', details: { status: 'withdrawn' } });
      }
    });

    it('a clean mark replaces a previous concern note and each mark sets a fresh reviewedAt (VS-234)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-11T03:00:00.000Z'));
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const first = decisions.review(conductor(), d.id, { status: 'concerns', note: 'split the migration' });
      expect(first.conductorReviewNote).toBe('split the migration');
      vi.setSystemTime(new Date('2026-09-11T03:00:01.000Z'));
      const second = decisions.review(conductor(), d.id, { status: 'looked', note: 'migration was split, all clear now' });
      expect(second.conductorReviewStatus).toBe('looked');
      expect(second.conductorReviewNote).toBe('migration was split, all clear now');
      expect(second.conductorReviewedAt! > first.conductorReviewedAt!).toBe(true);
      vi.useRealTimers();
    });

    it('emits decision.updated with the full Decision and enqueues no wake', async () => {
      const t = ticket();
      const d = decisions.create(AGENT, { ticketId: t.id, kind: 'plan_approval', title: 'Plan' });
      const before = wake.calls.length;
      const marked = decisions.review(conductor(), d.id, { status: 'looked', note: 'plan covers the scope' });
      await new Promise((r) => setImmediate(r));
      expect(h.events.some((e) => e.type === 'decision.updated' && (e.payload as { id: string }).id === marked.id)).toBe(true);
      const ev = h.events.find((e) => e.type === 'decision.updated')!;
      expect(ev.payload).toMatchObject({
        id: marked.id,
        conductorReviewStatus: 'looked',
        conductorReviewedByAgentId: h.conductorId,
      });
      expect(wake.calls.length).toBe(before);
    });

    it('answers an unseen plan_approval and a concerns merge_approval on the same path', async () => {
      const t = ticket();
      const workerId = h.addWorker(t.id);
      h.db.update('tickets', t.id, { status: 'proposed', workerId });
      const plan = decisions.create(AGENT, {
        ticketId: t.id, kind: 'plan_approval', title: 'Approve the plan', askedByAgentId: workerId,
        options: [{ key: 'approve', label: 'Approve' }, { key: 'revise', label: 'Revise' }, { key: 'reject', label: 'Reject' }],
      });
      expect(plan.conductorReviewStatus).toBe('unseen');
      await decisions.answer(HUMAN, plan.id, { key: 'approve' });
      expect(tickets.get(t.id).status).toBe('approved');
      expect(decisions.get(plan.id)).toMatchObject({
        answerKey: 'approve',
        conductorReviewStatus: 'unseen',
        conductorReviewedAt: null,
      });

      const t2 = ticket({ title: 'Merge this' });
      const worker2 = h.addWorker(t2.id);
      tickets.addWorkProduct(AGENT, t2.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
      h.db.update('tickets', t2.id, { status: 'in_review', workerId: worker2 });
      const merge = decisions.create(AGENT, {
        ticketId: t2.id, kind: 'merge_approval', title: 'Merge?', askedByAgentId: worker2,
        options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Changes' }],
      });
      const flagged = decisions.review(conductor(), merge.id, { status: 'concerns', note: 'screenshot is cropped' });
      expect(flagged.conductorReviewStatus).toBe('concerns');
      await decisions.answer(HUMAN, merge.id, { key: 'approve' });
      const answered = decisions.get(merge.id);
      expect(answered.answerKey).toBe('approve');
      expect(answered.conductorReviewStatus).toBe('concerns');
      expect(answered.conductorReviewNote).toBe('screenshot is cropped');
      expect(tickets.get(t2.id).status).toBe('merging');
    });
  });
});
