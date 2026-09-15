/**
 * VS-472: `autoMergeSweep` runs on every supervisor tick (~15 s). It used to post an identical
 * "auto-merge is waiting" comment on every pass, flooding a held ticket's thread. It now records the
 * reason and pull request head it is waiting on and comments only when that changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createDecisionsService } from '../decisions/service.js';
import type { Actor, DecisionsService, TicketsService } from '../api.js';

const AGENT: Actor = { kind: 'agent', id: 'worker-1', runId: 'run-1' };

const CONCERNS = 'auto-merge is waiting: the weaver has concerns';
const CI_RED = 'auto-merge is waiting: CI is red on the PR';

describe('auto-merge waiting comments (VS-472)', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let decisions: DecisionsService;
  let ciState: 'pending' | 'success' | 'failure' | 'none';
  let headSha: string | null;

  beforeEach(() => {
    h = makeHarness();
    ciState = 'success';
    headSha = 'head-a';
    h.services.wake = fakeWake() as never;
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
    setPolicies({ yolo: true });
  });
  afterEach(() => h.cleanup());

  const policiesOf = (id: string): Record<string, unknown> =>
    (h.db.get<{ policies: Record<string, unknown> | null }>('SELECT policies_json FROM projects WHERE id = ?', [id])?.policies ?? {});

  const setPolicies = (p: Record<string, unknown>, projectId = h.projectId): unknown =>
    h.db.update('projects', projectId, { policiesJson: { ...policiesOf(projectId), ...p } });

  const change = (over: Record<string, unknown> = {}): Ticket =>
    tickets.create({ kind: 'human', id: 'victor' }, { kind: 'change', title: 'Add dark mode', projectId: h.projectId, assigneeRoleId: h.roleId, ...over });

  /** Deliver a ticket: a PR work product and the `in_review` transition that raises the approval. */
  async function deliver(t: Ticket): Promise<Ticket> {
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: 'https://example.com/pr/1' });
    h.db.update('tickets', t.id, { status: 'in_progress' });
    return tickets.transition(AGENT, t.id, { to: 'in_review' });
  }

  const only = (ticketId: string, kind: string) =>
    decisions.list({ ticketId }).filter((d) => d.kind === kind)[0];

  const waiting = (ticketId: string, body: string) => tickets.comments(ticketId).filter((c) => c.body === body);

  /** A YOLO ticket whose merge approval the weaver has marked with concerns. */
  async function concernsHeld(): Promise<Ticket> {
    const t = change();
    h.addWorker(t.id);
    await deliver(t);
    const merge = only(t.id, 'merge_approval')!;
    decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' }, merge.id, { status: 'concerns', note: 'the diff still has a debug log' });
    return t;
  }

  it('posts one waiting comment however many sweeps run while the reason and head are unchanged', async () => {
    const t = await concernsHeld();

    expect(await tickets.autoMergeSweep()).toBe(0);
    expect(await tickets.autoMergeSweep()).toBe(0);
    expect(await tickets.autoMergeSweep()).toBe(0);

    expect(waiting(t.id, CONCERNS)).toHaveLength(1);
    expect(tickets.get(t.id).status).toBe('in_review');
  });

  it('posts one more when a new pull request head is still held', async () => {
    const t = await concernsHeld();
    await tickets.autoMergeSweep();
    expect(waiting(t.id, CONCERNS)).toHaveLength(1);

    headSha = 'head-b';
    expect(await tickets.autoMergeSweep()).toBe(0);
    expect(waiting(t.id, CONCERNS)).toHaveLength(2);
    expect((tickets.get(t.id).delivery?.['autoMergeHold'] as { head?: string }).head).toBe('head-b');
  });

  it('posts one more when the reason switches from concerns to CI red', async () => {
    const t = await concernsHeld();
    await tickets.autoMergeSweep();
    expect(waiting(t.id, CONCERNS)).toHaveLength(1);

    ciState = 'failure';
    expect(await tickets.autoMergeSweep()).toBe(0);
    expect(waiting(t.id, CONCERNS)).toHaveLength(1);
    expect(waiting(t.id, CI_RED)).toHaveLength(1);
  });

  it('does not re-post after a restart over the same database', async () => {
    const t = await concernsHeld();
    await tickets.autoMergeSweep();
    expect(waiting(t.id, CONCERNS)).toHaveLength(1);

    const restarted = createTicketsService(h.ctx, h.deps);
    h.services.tickets = restarted;
    expect(await restarted.autoMergeSweep()).toBe(0);
    expect(waiting(t.id, CONCERNS)).toHaveLength(1);
  });

  it('comments afresh when the ticket advances and returns held for the same reason', async () => {
    ciState = 'failure';
    const t = change();
    h.addWorker(t.id);
    await deliver(t);
    await tickets.autoMergeSweep();
    expect(waiting(t.id, CI_RED)).toHaveLength(1);

    // VS-474: the daemon's grant is held until the weaver reviews; mark it looked at the current head.
    const merge = only(t.id, 'merge_approval')!;
    await decisions.review({ kind: 'agent', id: h.conductorId, runId: 'run-conductor' }, merge.id, { status: 'looked', note: 'the diff is clean', reviewedHead: headSha! });

    // CI goes green: the sweep advances and drops the recorded hold.
    ciState = 'success';
    expect(await tickets.autoMergeSweep()).toBe(1);
    expect(tickets.get(t.id).delivery?.['autoMergeHold']).toBeUndefined();

    // The merge could not complete and the ticket is back in review, red again on the same head.
    h.db.update('tickets', t.id, { status: 'in_review' });
    ciState = 'failure';
    expect(await tickets.autoMergeSweep()).toBe(0);
    expect(waiting(t.id, CI_RED)).toHaveLength(2);
  });
});