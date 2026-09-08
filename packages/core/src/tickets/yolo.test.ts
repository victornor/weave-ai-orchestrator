/**
 * YOLO mode (PLAN §15): the daemon answers a ticket's plan and merge approvals itself. Real tickets
 * and real decisions, because the point of the mode is what ends up in the `decisions` table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import type { Ticket } from '@agent-conductor/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createDecisionsService } from '../decisions/service.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const AGENT: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };

describe('YOLO mode', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let decisions: DecisionsService;
  let wake: ReturnType<typeof fakeWake>;
  let ciState: 'pending' | 'success' | 'failure' | 'none';

  beforeEach(() => {
    h = makeHarness();
    h.ctx.config.defaults.yolo = true;
    wake = fakeWake();
    ciState = 'success';
    h.services.wake = wake as never;
    h.services.knowledge = { appendDecision: vi.fn() } as never;
    h.services.roles = { activate: vi.fn(async () => ({ id: 'role' })), get: vi.fn(() => ({ projectId: h.projectId, name: 'Backend' })) } as never;
    h.services.workers = { spawnForTicket: vi.fn(async (_a: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })) } as never;
    h.services.specs = { index: vi.fn(async () => undefined) } as never;
    h.services.projects = { get: (id: string) => ({ id, clonePath: '/tmp/clone', policies: policiesOf(id) }) } as never;
    h.services.openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan\n\n## Proposal\nbody' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: null })),
    } as never;
    h.ctx.registries.forges.set('github', { prState: async () => ({ state: 'open' as const, ciState }) } as never);
    tickets = createTicketsService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    h.services.decisions = decisions;
  });
  afterEach(() => h.cleanup());

  const policiesOf = (id: string): Record<string, unknown> =>
    (h.db.get<{ policies: Record<string, unknown> | null }>('SELECT policies_json FROM projects WHERE id = ?', [id])?.policies ?? {});

  const setPolicies = (p: Record<string, unknown>, projectId = h.projectId): unknown =>
    h.db.update('projects', projectId, { policiesJson: p });

  /** A second project, so an override can be shown not to leak across projects. */
  function otherProject(): string {
    const id = newId();
    const now = nowIso();
    h.db.insert('projects', {
      id, workspaceId: h.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@example.com:acme/web.git', defaultBranch: 'main',
      clonePath: '/tmp/web', maxWorkers: 4, worktreeProvider: 'git',
      openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: now, updatedAt: now,
    });
    return id;
  }

  const change = (over: Record<string, unknown> = {}): Ticket =>
    tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  /** Take a `change` ticket to the point where its plan validates. */
  async function propose(t: Ticket): Promise<Ticket> {
    h.db.update('tickets', t.id, { status: 'proposing' });
    return tickets.transition(AGENT, t.id, { to: 'proposed' });
  }

  /** Deliver a ticket: a PR work product and the `in_review` transition that raises the approval. */
  async function deliver(t: Ticket): Promise<Ticket> {
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.update('tickets', t.id, { status: 'in_progress' });
    return tickets.transition(AGENT, t.id, { to: 'in_review' });
  }

  const only = (ticketId: string, kind: string) =>
    decisions.list({ ticketId }).filter((d) => d.kind === kind)[0];

  describe('plan approvals', () => {
    it('answers the plan approval as the system and moves the ticket on', async () => {
      const t = change();
      const workerId = h.addWorker(t.id);
      const next = await propose(t);

      expect(next.status).toBe('approved');
      const d = only(t.id, 'plan_approval');
      expect(d?.status).toBe('answered');
      expect(d?.answerKey).toBe('approve');
      expect(d?.answeredByKind).toBe('system');
      expect(d?.answerText).toContain('YOLO mode');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('leaves the approval to the human when the mode is off', async () => {
      h.ctx.config.defaults.yolo = false;
      const t = change();
      const next = await propose(t);

      expect(next.status).toBe('proposed');
      expect(only(t.id, 'plan_approval')?.status).toBe('open');
    });

    it('approves nothing when the plan does not validate', async () => {
      (h.services.openspec as unknown as { validateForProposed: ReturnType<typeof vi.fn> }).validateForProposed
        .mockResolvedValueOnce({ ok: false, issues: [{ level: 'error', message: 'no tasks' }] });
      const t = change();
      h.db.update('tickets', t.id, { status: 'proposing' });

      await expect(tickets.transition(AGENT, t.id, { to: 'proposed' })).rejects.toMatchObject({ code: 'openspec_validation_failed' });
      expect(tickets.get(t.id).status).toBe('proposing');
      expect(decisions.list({ ticketId: t.id })).toHaveLength(0);
    });

    it('still takes the no-decision path when the project says nobody approves plans', async () => {
      setPolicies({ proposalApproval: 'none' });
      const t = change();
      const next = await propose(t);

      expect(next.status).toBe('approved');
      expect(decisions.list({ ticketId: t.id })).toHaveLength(0);
    });
  });

  describe('merge approvals', () => {
    it('answers the merge approval as the system once the PR checks are green', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');

      expect(await tickets.autoMergeSweep()).toBe(1);

      const d = only(t.id, 'merge_approval');
      expect(d?.status).toBe('answered');
      expect(d?.answeredByKind).toBe('system');
      expect(d?.answerText).toContain('YOLO mode');
      const after = tickets.get(t.id);
      expect(after.status).toBe('merging');
      expect(after.mergeQueuedAt).not.toBeNull();
    });

    it('leaves the approval open while the checks are still running', async () => {
      ciState = 'pending';
      const t = change();
      h.addWorker(t.id);
      await deliver(t);

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.get(t.id).status).toBe('in_review');
    });

    it('leaves the approval open and says so when the checks have failed', async () => {
      ciState = 'failure';
      const t = change();
      h.addWorker(t.id);
      await deliver(t);

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.comments(t.id).some((c) => c.body.includes('CI is red'))).toBe(true);
    });

    it('does not wait for checks when the project does not require them', async () => {
      ciState = 'pending';
      setPolicies({ requireCi: false });
      const t = change();
      h.addWorker(t.id);
      await deliver(t);

      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(only(t.id, 'merge_approval')?.status).toBe('answered');
    });

    it('leaves an already-open approval to the human once the mode is turned off', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      h.ctx.config.defaults.yolo = false;

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.get(t.id).status).toBe('in_review');
    });

    it('does not revert a ticket the mode already moved on', async () => {
      const t = change();
      h.addWorker(t.id);
      await propose(t);
      expect(tickets.get(t.id).status).toBe('approved');

      h.ctx.config.defaults.yolo = false;
      expect(only(t.id, 'plan_approval')?.status).toBe('answered');
      expect(tickets.get(t.id).status).toBe('approved');
    });

    it('keeps an auto_merge ticket on its own decision-free path', async () => {
      const t = change({ autoMerge: true });
      h.addWorker(t.id);
      await deliver(t);

      expect(decisions.list({ ticketId: t.id })).toHaveLength(0);
      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(tickets.get(t.id).status).toBe('merging');
    });
  });

  describe('what the mode does not touch', () => {
    it('leaves every other decision kind open and owned as usual', async () => {
      const t = change();
      const workerId = h.addWorker(t.id);
      // `retry_approval` is absent on purpose: `decisions.kind`'s CHECK constraint in
      // 0001_init.sql does not list it, so one cannot be inserted at all. That is a pre-existing
      // defect in the stuck-worker path (runs/engine.ts:447), not something this mode touches.
      const raised = [
        decisions.create(AGENT, { ticketId: t.id, kind: 'hire_approval', title: 'Hire?', target: { roleId: h.roleId } }),
        decisions.create(AGENT, { ticketId: t.id, kind: 'discard_approval', title: 'Discard?' }),
        decisions.create(AGENT, { ticketId: t.id, kind: 'gate_finding', title: 'Finding' }),
        decisions.create(AGENT, { ticketId: t.id, kind: 'question', title: 'Which store?', askedByAgentId: workerId }),
      ];

      await tickets.autoMergeSweep();
      for (const d of raised) expect(decisions.get(d.id).status).toBe('open');
      expect(decisions.get(raised[2]!.id).owner).toBe('conductor');
      // VS-127: a worker's `question` now resolves to the conductor, never the human, whichever
      // askable kind it names — YOLO does not touch this path either way.
      expect(decisions.get(raised[3]!.id).owner).toBe('conductor');
    });
  });

  describe('the project override', () => {
    it('lets a project opt out of a workspace that has the mode on', async () => {
      setPolicies({ yolo: false });
      const t = change();
      const next = await propose(t);

      expect(next.status).toBe('proposed');
      expect(only(t.id, 'plan_approval')?.status).toBe('open');
    });

    it('lets a project opt in to a workspace that has the mode off', async () => {
      h.ctx.config.defaults.yolo = false;
      setPolicies({ yolo: true });
      const t = change();
      h.addWorker(t.id);
      const next = await propose(t);

      expect(next.status).toBe('approved');
      expect(only(t.id, 'plan_approval')?.answeredByKind).toBe('system');
    });

    it('leaves a sibling project alone', async () => {
      h.ctx.config.defaults.yolo = false;
      const web = otherProject();
      setPolicies({ yolo: true }, web);

      const mine = change({ projectId: web, assigneeRoleId: null });
      expect((await propose(mine)).status).toBe('approved');

      const theirs = change({ title: 'Other work' });
      expect((await propose(theirs)).status).toBe('proposed');
      expect(only(theirs.id, 'plan_approval')?.status).toBe('open');
    });
  });
});
