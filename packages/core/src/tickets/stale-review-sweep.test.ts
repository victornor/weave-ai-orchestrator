/**
 * VS-670: the decision-centric safety net beside `autoMergeSweep`. A reviewed auto-approval the
 * daemon could not resolve must be caught and, where the daemon can still grant it, granted — or at
 * least surfaced once — rather than sitting silently for hours (the VS-665 failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createDecisionsService } from '../decisions/service.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const AGENT: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };
const STUCK = 'auto-merge is stuck';

describe('stale reviewed-approval sweep (VS-670)', () => {
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
    mkdirSync(h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath, { recursive: true });
    setPolicies({ yolo: true });
  });
  afterEach(() => h.cleanup());

  const policiesOf = (id: string): Record<string, unknown> =>
    (h.db.get<{ policies: Record<string, unknown> | null }>('SELECT policies_json FROM projects WHERE id = ?', [id])?.policies ?? {});

  const setPolicies = (p: Record<string, unknown>, projectId = h.projectId): unknown =>
    h.db.update('projects', projectId, { policiesJson: { ...policiesOf(projectId), ...p } });

  const change = (over: Record<string, unknown> = {}): Ticket =>
    tickets.create(HUMAN, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  async function propose(t: Ticket): Promise<Ticket> {
    h.db.update('tickets', t.id, { status: 'proposing' });
    return tickets.transition(AGENT, t.id, { to: 'proposed' });
  }

  async function deliver(t: Ticket): Promise<Ticket> {
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.update('tickets', t.id, { status: 'in_progress' });
    return tickets.transition(AGENT, t.id, { to: 'in_review' });
  }

  const only = (ticketId: string, kind: string) =>
    decisions.list({ ticketId }).filter((d) => d.kind === kind)[0];

  const conductor = (): Actor => ({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' });

  const stuckComments = (ticketId: string) => tickets.comments(ticketId).filter((c) => c.body.includes(STUCK));

  const weaverWakes = () => wake.calls.filter((c) => c.agentId === h.conductorId && String(c.input.reason).includes('has not resolved'));

  /** Back-date a card's review mark past the sweep's threshold. */
  const backDate = (decisionId: string, minutes = 30): void => {
    h.db.update('decisions', decisionId, { weaverReviewedAt: new Date(Date.now() - minutes * 60_000).toISOString() });
  };

  it('grants a looked plan card whose mark-path grant was missed', async () => {
    const t = change();
    await propose(t);
    const plan = only(t.id, 'plan_approval')!;
    // Simulate the mark's grant having been lost: the card reads looked but is still open.
    h.db.update('decisions', plan.id, { weaverReviewStatus: 'looked', weaverReviewNote: 'the plan is sound' });
    backDate(plan.id);

    expect(await tickets.staleReviewSweep()).toBe(1);
    expect(only(t.id, 'plan_approval')).toMatchObject({ status: 'answered', answeredByKind: 'system' });
    expect(tickets.get(t.id).status).toBe('approved');
  });

  it('surfaces a stale looked merge card once, and not again on the next sweep', async () => {
    const t = change();
    h.addWorker(t.id);
    await deliver(t);
    const merge = only(t.id, 'merge_approval')!;
    await decisions.review(conductor(), merge.id, { status: 'looked', note: 'the diff is clean', reviewedHead: headSha });
    backDate(merge.id);

    expect(await tickets.staleReviewSweep()).toBe(1);
    expect(stuckComments(t.id)).toHaveLength(1);
    expect(weaverWakes()).toHaveLength(1);
    // The ordinary merge is the merge sweep's to grant; the safety net only surfaces it.
    expect(only(t.id, 'merge_approval')?.status).toBe('open');

    const before = wake.calls.length;
    expect(await tickets.staleReviewSweep()).toBe(0);
    expect(stuckComments(t.id)).toHaveLength(1);
    expect(wake.calls.length).toBe(before);
  });

  it('surfaces a stale concerns card once and never grants it', async () => {
    const t = change();
    h.addWorker(t.id);
    await deliver(t);
    const merge = only(t.id, 'merge_approval')!;
    await decisions.review(conductor(), merge.id, { status: 'concerns', note: 'the diff has a debug log' });
    backDate(merge.id);

    expect(await tickets.staleReviewSweep()).toBe(1);
    expect(only(t.id, 'merge_approval')?.status).toBe('open');
    expect(stuckComments(t.id)).toHaveLength(1);
    expect(tickets.get(t.id).status).toBe('in_review');
  });

  it('leaves a reviewed card on a project whose mode is off untouched', async () => {
    setPolicies({ yolo: false });
    const t = change();
    h.addWorker(t.id);
    await deliver(t);
    const merge = only(t.id, 'merge_approval')!;
    h.db.update('decisions', merge.id, { weaverReviewStatus: 'looked', weaverReviewNote: 'clean', weaverReviewedAt: new Date().toISOString() });
    backDate(merge.id);

    expect(await tickets.staleReviewSweep()).toBe(0);
    expect(only(t.id, 'merge_approval')?.status).toBe('open');
    expect(stuckComments(t.id)).toHaveLength(0);
  });

  it('leaves an unseen card untouched', async () => {
    const t = change();
    h.addWorker(t.id);
    await deliver(t);

    expect(await tickets.staleReviewSweep()).toBe(0);
    expect(only(t.id, 'merge_approval')?.status).toBe('open');
    expect(stuckComments(t.id)).toHaveLength(0);
  });
});
