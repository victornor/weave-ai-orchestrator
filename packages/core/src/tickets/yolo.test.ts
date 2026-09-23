/**
 * YOLO mode (PLAN §15): the daemon answers a ticket's plan and merge approvals itself. Real tickets
 * and real decisions, because the point of the mode is what ends up in the `decisions` table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { newId, nowIso } from '@weave-ai/db';
import type { Ticket } from '@weave-ai/shared';
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
  let headSha: string;

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    ciState = 'success';
    headSha = 'a'.repeat(40);
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
    h.ctx.registries.forges.set('github', { prState: async () => ({ state: 'open' as const, ciState, headSha }) } as never);
    tickets = createTicketsService(h.ctx, h.deps);
    decisions = createDecisionsService(h.ctx, h.deps);
    h.services.tickets = tickets;
    h.services.decisions = decisions;
    // VS-474: the grant hold resolves the PR head through the project clone, so it must exist.
    mkdirSync(h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath, { recursive: true });
    // VS-382: the mode is a per-project setting with no workspace default, so the harness turns it on
    // for the ticket's own project rather than mutating config.
    setPolicies({ yolo: true });
  });
  afterEach(() => h.cleanup());

  const policiesOf = (id: string): Record<string, unknown> =>
    (h.db.get<{ policies: Record<string, unknown> | null }>('SELECT policies_json FROM projects WHERE id = ?', [id])?.policies ?? {});

  /** Merge `p` into a project's stored policies, so a test changes one key without dropping YOLO. */
  const setPolicies = (p: Record<string, unknown>, projectId = h.projectId): unknown =>
    h.db.update('projects', projectId, { policiesJson: { ...policiesOf(projectId), ...p } });

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

  const conductor = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' });

  /** VS-474: release the daemon's grant for a card by marking it looked at the current head. */
  const markLooked = async (decisionId: string, note = 'the work is clean', head: string | null = headSha): Promise<void> => {
    await decisions.review(conductor(), decisionId, { status: 'looked', note, reviewedHead: head });
  };

  describe('plan approvals', () => {
    it('leaves the plan approval open and unseen until the weaver looks, then grants it as the system', async () => {
      const t = change();
      const workerId = h.addWorker(t.id);
      const next = await propose(t);

      // VS-474: no grant at raise time — the card is the weaver's to review.
      expect(next.status).toBe('proposed');
      const open = only(t.id, 'plan_approval');
      expect(open?.status).toBe('open');
      expect(open?.weaverReviewStatus).toBe('unseen');

      await markLooked(open!.id, 'the plan covers the ticket');
      const d = only(t.id, 'plan_approval');
      expect(tickets.get(t.id).status).toBe('approved');
      expect(d?.status).toBe('answered');
      expect(d?.answerKey).toBe('approve');
      expect(d?.answeredByKind).toBe('system');
      expect(d?.answerText).toContain('YOLO mode');
      expect(wake.calls.some((c) => c.agentId === workerId && c.input.source === 'ticket_assigned')).toBe(true);
    });

    it('leaves the approval to the human when the mode is off', async () => {
      setPolicies({ yolo: false });
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
    it('holds the merge approval while unseen, and grants it as the system once looked and green', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;
      expect(merge.status).toBe('open');
      expect(merge.weaverReviewStatus).toBe('unseen');

      // VS-474: green checks are not enough while the card is unreviewed.
      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(tickets.get(t.id).status).toBe('in_review');
      expect(tickets.comments(t.id).some((c) => c.body === 'auto-merge is waiting: the weaver has not reviewed it yet')).toBe(true);

      await markLooked(merge.id, 'the diff is clean');
      expect(await tickets.autoMergeSweep()).toBe(1);

      const d = only(t.id, 'merge_approval');
      expect(d?.status).toBe('answered');
      expect(d?.answeredByKind).toBe('system');
      expect(d?.answerText).toContain('YOLO mode');
      const after = tickets.get(t.id);
      expect(after.status).toBe('merging');
      expect(after.mergeQueuedAt).not.toBeNull();
    });

    it('holds a looked merge whose head moved, and grants after a fresh look at the new head', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;
      await markLooked(merge.id, 'the diff is clean', headSha);

      headSha = 'b'.repeat(40);
      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(tickets.get(t.id).status).toBe('in_review');
      expect(tickets.comments(t.id).some((c) => c.body === 'auto-merge is waiting: the weaver has not reviewed the current head yet')).toBe(true);

      // VS-474: the pushed head wakes the weaver to re-review, not just a comment on the ticket.
      const before = wake.calls.length;
      expect((await tickets.noteHeldReviewHead(conductor(), t.id)).woken).toBe(true);
      const reReview = wake.calls.slice(before).filter((c) => c.agentId === h.conductorId);
      expect(reReview).toHaveLength(1);
      expect(String(reReview[0]!.input.reason)).toContain(headSha.slice(0, 12));

      await markLooked(merge.id, 're-read at the new head', headSha);
      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(tickets.get(t.id).status).toBe('merging');
    });

    it('reproduces 2026-09-15: a never-reviewed merge card stays unlanded across five sweeps, then lands after the look', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;

      // Five sweeps (~15 s apart in the supervisor) must all hold: this is the ticket the four
      // auto-granted landings of 2026-09-15 went through unreviewed.
      for (let i = 0; i < 5; i++) expect(await tickets.autoMergeSweep()).toBe(0);
      expect(tickets.get(t.id).status).toBe('in_review');
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      // The waiting comment is recorded once per reason, not once per sweep (VS-472).
      expect(tickets.comments(t.id).filter((c) => c.body === 'auto-merge is waiting: the weaver has not reviewed it yet')).toHaveLength(1);

      await markLooked(merge.id, 'read the diff, no concerns');
      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(tickets.get(t.id).status).toBe('merging');
      expect(only(t.id, 'merge_approval')).toMatchObject({ status: 'answered', answeredByKind: 'system' });
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

    it('does not silently approve an unattended merge the weaver has concerns about (VS-266)', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;
      decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' }, merge.id, { status: 'concerns', note: 'the diff still has a debug log' });

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.get(t.id).status).toBe('in_review');
      expect(tickets.comments(t.id).some((c) => c.body.includes('the weaver has concerns'))).toBe(true);
    });

    it('does not wait for checks when the project does not require them', async () => {
      ciState = 'pending';
      setPolicies({ requireCi: false });
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      // VS-474: the mode still waits for the review, even when checks are not required.
      await markLooked(only(t.id, 'merge_approval')!.id, 'the diff is clean');

      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(only(t.id, 'merge_approval')?.status).toBe('answered');
    });

    it('leaves an already-open approval to the human once the mode is turned off', async () => {
      const t = change();
      h.addWorker(t.id);
      await deliver(t);
      setPolicies({ yolo: false });

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.get(t.id).status).toBe('in_review');
    });

    it('does not revert a ticket the mode already moved on', async () => {
      const t = change();
      h.addWorker(t.id);
      await propose(t);
      // VS-474: the plan is granted only after the review.
      await markLooked(only(t.id, 'plan_approval')!.id, 'the plan is sound');
      expect(tickets.get(t.id).status).toBe('approved');

      setPolicies({ yolo: false });
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
      expect(decisions.get(raised[2]!.id).owner).toBe('weaver');
      // VS-127: a worker's `question` now resolves to the conductor, never the human, whichever
      // askable kind it names — YOLO does not touch this path either way.
      expect(decisions.get(raised[3]!.id).owner).toBe('weaver');
    });
  });

  describe('per project, with no workspace default (VS-382)', () => {
    it('leaves the approval to the human for a project that has it off', async () => {
      setPolicies({ yolo: false });
      const t = change();
      const next = await propose(t);

      expect(next.status).toBe('proposed');
      expect(only(t.id, 'plan_approval')?.status).toBe('open');
    });

    it('is off for a project that has no yolo key, whatever a sibling has', async () => {
      setPolicies({ yolo: false });
      const t = change();
      expect((await propose(t)).status).toBe('proposed');
    });

    it('resolves per project: the project that sets it auto-approves, its sibling does not', async () => {
      setPolicies({ yolo: false });
      const web = otherProject();
      setPolicies({ yolo: true }, web);

      const mine = change({ projectId: web, assigneeRoleId: null });
      // VS-578: `web` has OpenSpec on, so its `change` tickets are bound to a change; this fixture
      // creates one without a role, so bind it here as the spawn-time binder would.
      h.db.update('tickets', mine.id, { openspecChangeName: 'tst-1-mine' });
      expect((await propose(mine)).status).toBe('proposed');
      // VS-474: the review is what releases the daemon's grant.
      await markLooked(only(mine.id, 'plan_approval')!.id, 'the plan is sound');
      expect(tickets.get(mine.id).status).toBe('approved');

      const theirs = change({ title: 'Other work' });
      expect((await propose(theirs)).status).toBe('proposed');
      expect(only(theirs.id, 'plan_approval')?.status).toBe('open');
    });
  });

  describe('project resolution (VS-670)', () => {
    it('grants a reviewed merge when the ticket row has a null project but its role names one', async () => {
      const t = change();
      h.addWorker(t.id);
      // The pre-VS-668 row shape: filed with a project-scoped role but stored with a null project.
      // The auto-approval path must still find the project through the role.
      h.db.update('tickets', t.id, { projectId: null });
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;
      await markLooked(merge.id, 'the diff is clean');

      expect(await tickets.autoMergeSweep()).toBe(1);
      expect(only(t.id, 'merge_approval')).toMatchObject({ status: 'answered', answeredByKind: 'system' });
      expect(tickets.get(t.id).status).toBe('merging');
    });

    it('still treats a ticket with neither a project nor a role as mode off', async () => {
      const t = tickets.create(HUMAN, { kind: 'change', title: 'Workspace-level work', projectId: null, assigneeRoleId: null });
      h.addWorker(t.id);
      await deliver(t);
      const merge = only(t.id, 'merge_approval')!;
      await markLooked(merge.id, 'the diff is clean');

      expect(await tickets.autoMergeSweep()).toBe(0);
      expect(only(t.id, 'merge_approval')?.status).toBe('open');
      expect(tickets.get(t.id).status).toBe('in_review');
    });
  });
});

