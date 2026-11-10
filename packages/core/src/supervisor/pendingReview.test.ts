/**
 * VS-956: a digest wake names its unreviewed approval cards when queued, but sits until the weaver's
 * current turn ends — and the weaver's own review mark lands in between. The claim re-checks the named
 * cards, so a marked card is never reported as unreviewed while a genuinely unmarked one still is.
 */
import { newId, nowIso } from '@weave-ai/db';
import type { Wakeup } from '@weave-ai/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import type { WakeService } from '../api.js';
import { createWakeService } from '../wake/index.js';
import { refreshQueuedDigests, reviewNote, type PendingReviewEntry } from './pendingReview.js';

let h: TestHarness;
let wake: WakeService;
beforeEach(() => { h = makeHarness(); wake = createWakeService(h.ctx, h.deps); h.services.wake = wake; });
afterEach(() => h.cleanup());

function seedApproval(over: Record<string, unknown> = {}): { id: string; entry: PendingReviewEntry } {
  const id = newId();
  const createdAt = new Date(Date.now() - 7_000).toISOString();
  h.db.insert('decisions', {
    id, workspaceId: h.workspaceId, ticketId: null, kind: 'plan_approval', owner: 'human', title: 'Plan?', context: '',
    optionsJson: [], allowFreeText: 1, status: 'open', createdAt, ...over,
  });
  return { id, entry: { decisionId: id, kind: 'plan_approval', ticketIdentifier: 'TST-1', title: 'Plan?', ageMs: 7_000 } };
}

function queueDigest(entries: PendingReviewEntry[]): Wakeup {
  return wake.enqueue(h.conductorId, {
    source: 'system', reason: `digest${reviewNote(entries)}`, payload: { events: [], pendingReview: entries },
  });
}

const reload = (w: Wakeup): Wakeup => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [w.id])!;

describe('refreshQueuedDigests (VS-956)', () => {
  it('drops a card marked looked after the digest was queued, with or without waitingOn', () => {
    const a = seedApproval();
    const b = seedApproval();
    const queued = queueDigest([a.entry, b.entry]);
    expect(queued.reason).toContain('2 approval cards still not reviewed');
    h.db.update('decisions', a.id, { weaverReviewStatus: 'looked' });
    h.db.update('decisions', b.id, { weaverReviewStatus: 'looked', weaverReviewWaitingOn: 'CI on 3381a91' });
    refreshQueuedDigests(h.ctx, [reload(queued)]);
    const after = reload(queued);
    expect(after.reason).toBe('digest');
    expect(after.payload).not.toHaveProperty('pendingReview');
  });

  it('still reports a card left unmarked, recounting the note and the age', () => {
    const marked = seedApproval();
    const unmarked = seedApproval();
    const queued = queueDigest([marked.entry, unmarked.entry]);
    h.db.update('decisions', marked.id, { weaverReviewStatus: 'looked' });
    refreshQueuedDigests(h.ctx, [reload(queued)]);
    const after = reload(queued);
    expect(after.reason).toContain('1 approval card still not reviewed: TST-1 plan');
    expect((after.payload as { pendingReview: PendingReviewEntry[] }).pendingReview.map((p) => p.decisionId)).toEqual([unmarked.id]);
  });

  it('leaves an untouched digest alone', () => {
    const a = seedApproval();
    const queued = queueDigest([a.entry]);
    const before = reload(queued);
    refreshQueuedDigests(h.ctx, [before]);
    expect(reload(queued).reason).toBe(before.reason);
  });

  it('refreshes a digest that was coalesced into an already-queued wake', () => {
    const a = seedApproval();
    wake.enqueue(h.conductorId, { source: 'system', reason: 'something else' });
    queueDigest([a.entry]);
    h.db.update('decisions', a.id, { weaverReviewStatus: 'looked' });
    const target = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE status = 'queued' AND agent_id = ?", [h.conductorId])!;
    refreshQueuedDigests(h.ctx, [target]);
    const bundle = (reload(target).payload as { bundle: Array<{ reason: string; payload: Record<string, unknown> }> }).bundle;
    expect(bundle[0]!.reason).toBe('digest');
    expect(bundle[0]!.payload).not.toHaveProperty('pendingReview');
  });

  it('refreshes a digest coalesced into a non-system wake (VS-976)', () => {
    const marked = seedApproval();
    const unmarked = seedApproval();
    const carrier = wake.enqueue(h.conductorId, { source: 'human_message', reason: 'hello', payload: { threadId: 't' } });
    queueDigest([marked.entry, unmarked.entry]);
    h.db.update('decisions', marked.id, { weaverReviewStatus: 'looked' });
    refreshQueuedDigests(h.ctx, [reload(carrier)]);
    const after = reload(carrier);
    expect(after.reason).toBe('hello');
    const bundle = (after.payload as { bundle: Array<{ reason: string; payload: { pendingReview?: PendingReviewEntry[] } }> }).bundle;
    expect(bundle[0]!.reason).toContain('1 approval card still not reviewed');
    expect(bundle[0]!.payload.pendingReview!.map((p) => p.decisionId)).toEqual([unmarked.id]);
  });

  it('refreshes a digest already claimed, in the row the prompt is built from (VS-976)', () => {
    const a = seedApproval();
    const queued = queueDigest([a.entry]);
    h.db.update('wakeups', queued.id, { status: 'claimed', claimedAt: nowIso() });
    h.db.update('decisions', a.id, { weaverReviewStatus: 'looked' });
    const claimed = reload(queued);
    refreshQueuedDigests(h.ctx, [claimed]);
    expect(claimed.reason).toBe('digest');
    expect(claimed.payload).not.toHaveProperty('pendingReview');
    expect(reload(queued).reason).toBe('digest');
  });

  it('leaves a non-digest wake untouched (VS-976)', () => {
    const carrier = wake.enqueue(h.conductorId, { source: 'human_message', reason: 'hello', payload: { threadId: 't' } });
    const before = reload(carrier);
    refreshQueuedDigests(h.ctx, [before]);
    expect(reload(carrier)).toEqual(before);
  });

  it('stops naming a card that was answered or withdrawn meanwhile', () => {
    const a = seedApproval();
    const queued = queueDigest([a.entry]);
    h.db.update('decisions', a.id, { status: 'answered' });
    refreshQueuedDigests(h.ctx, [reload(queued)]);
    expect(reload(queued).reason).toBe('digest');
  });
});
