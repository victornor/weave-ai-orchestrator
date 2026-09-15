import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import { createWakeService } from '../wake/index.js';
import { git } from '../util/git.js';
import type { Actor, TicketsService } from '../api.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const REVIEWED = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const MOVED_AGAIN = 'c'.repeat(40);

/**
 * VS-365: a fix pushed to a merge card the weaver holds under concerns must wake the weaver by itself.
 * These use the real wake service, not a double, because the "same head wakes only once" guarantee is
 * the wake queue's idempotency key, which the double does not implement.
 */
describe('held review head', () => {
  let h: TestHarness;
  let tickets: TicketsService;

  beforeEach(() => {
    h = makeHarness();
    // The real wake service, so the idempotency key is exercised exactly as in the daemon.
    h.services.wake = createWakeService(h.ctx, h.deps);
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

  const makeTicket = (): string => {
    const t = tickets.create({ kind: 'system', id: null }, { kind: 'change', title: 'Add dark mode', projectId: h.projectId });
    return t.id;
  };

  const seedMerge = (ticketId: string, over: Record<string, unknown> = {}): string => {
    const id = newId();
    h.db.insert('decisions', {
      id, workspaceId: h.workspaceId, ticketId, kind: 'merge_approval', owner: 'human', title: 'Approve the merge',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open',
      weaverReviewStatus: 'concerns', weaverReviewedAt: nowIso(), weaverReviewNote: 'fix the crash',
      weaverReviewedHeadSha: REVIEWED, createdAt: nowIso(), ...over,
    });
    return id;
  };

  const heldKeys = (): string[] =>
    h.db.all<{ idempotencyKey: string }>(
      "SELECT idempotency_key AS idempotencyKey FROM wakeups WHERE agent_id = ? AND idempotency_key LIKE 'held-review:%' ORDER BY created_at",
      [h.conductorId],
    ).map((r) => r.idempotencyKey);

  const heldWakes = (): Array<{ reason: string; payloadJson: string }> =>
    h.db.all("SELECT reason, payload_json AS payloadJson FROM wakeups WHERE agent_id = ? AND idempotency_key LIKE 'held-review:%'", [h.conductorId]);

  it('wakes the weaver exactly once when the head moved since the review', async () => {
    const ticketId = makeTicket();
    const decisionId = seedMerge(ticketId);

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(result).toEqual({ woken: true, decisionId, headSha: MOVED });
    expect(heldKeys()).toEqual([`held-review:${decisionId}:${MOVED}`]);
    const wake = heldWakes()[0]!;
    expect(wake.reason).toContain('TST-1');
    expect(wake.reason).toContain(MOVED.slice(0, 12));
    expect(wake.payloadJson).toContain(decisionId);
    // Notification only: the hold is untouched.
    expect(h.db.get('SELECT * FROM decisions WHERE id = ?', [decisionId])).toMatchObject({
      status: 'open', weaverReviewStatus: 'concerns', weaverReviewedHeadSha: REVIEWED,
    });
  });

  it('does not wake again for the same head', async () => {
    const ticketId = makeTicket();
    seedMerge(ticketId);

    await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);
    const second = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(second.woken).toBe(false);
    expect(heldKeys()).toHaveLength(1);
  });

  it('wakes once more for a second new commit', async () => {
    const ticketId = makeTicket();
    const decisionId = seedMerge(ticketId);

    await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);
    await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);
    const third = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED_AGAIN);

    expect(third.woken).toBe(true);
    expect(heldKeys()).toEqual([
      `held-review:${decisionId}:${MOVED}`,
      `held-review:${decisionId}:${MOVED_AGAIN}`,
    ]);
  });

  it('does not wake for the head recorded at the review', async () => {
    const ticketId = makeTicket();
    seedMerge(ticketId);

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, REVIEWED);

    expect(result.woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  it('does not wake for an unreviewed card', async () => {
    const unseen = tickets.create({ kind: 'system', id: null }, { kind: 'change', title: 'Unreviewed', projectId: h.projectId });
    seedMerge(unseen.id, { weaverReviewStatus: 'unseen', weaverReviewedAt: null, weaverReviewNote: null, weaverReviewedHeadSha: null });
    expect((await tickets.noteHeldReviewHead(SYSTEM, unseen.id, MOVED)).woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  it('wakes the weaver to re-review a looked card whose head moved (VS-474)', async () => {
    const ticketId = makeTicket();
    const decisionId = seedMerge(ticketId, { weaverReviewStatus: 'looked', weaverReviewNote: 'clean' });

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(result).toEqual({ woken: true, decisionId, headSha: MOVED });
    expect(heldKeys()).toEqual([`held-review:${decisionId}:${MOVED}`]);
    const wake = heldWakes()[0]!;
    expect(wake.reason).toContain('TST-1');
    expect(wake.reason).toContain(REVIEWED.slice(0, 12));
    expect(wake.reason).toContain(MOVED.slice(0, 12));
    expect(wake.reason).toContain('re-review');
    expect(wake.payloadJson).toContain(decisionId);
    // Notification only: the looked mark and its reviewed head are untouched, so the grant stays held.
    expect(h.db.get('SELECT * FROM decisions WHERE id = ?', [decisionId])).toMatchObject({
      status: 'open', weaverReviewStatus: 'looked', weaverReviewedHeadSha: REVIEWED,
    });
  });

  it('does not wake for a looked card whose head is unchanged', async () => {
    const ticketId = makeTicket();
    seedMerge(ticketId, { weaverReviewStatus: 'looked', weaverReviewNote: 'clean' });

    expect((await tickets.noteHeldReviewHead(SYSTEM, ticketId, REVIEWED)).woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  it('never baselines a looked card with no recorded head (VS-474)', async () => {
    const ticketId = makeTicket();
    const decisionId = seedMerge(ticketId, { weaverReviewStatus: 'looked', weaverReviewNote: 'clean', weaverReviewedHeadSha: null });

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(result).toEqual({ woken: false, decisionId });
    // Baselining would record a head that was never reviewed, defeating the head-match hold.
    expect(h.db.get('SELECT weaver_reviewed_head_sha AS h FROM decisions WHERE id = ?', [decisionId])!.h).toBeNull();
    expect(heldKeys()).toHaveLength(0);
  });

  it('does not wake for a plan approval marked concerns', async () => {
    const ticketId = makeTicket();
    seedMerge(ticketId, { kind: 'plan_approval' });

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(result.woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  it('does not wake for an answered decision', async () => {
    const ticketId = makeTicket();
    seedMerge(ticketId, { status: 'answered', answerKey: 'approve', answeredAt: nowIso() });

    expect((await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED)).woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  it('baselines a decision whose review resolved no head, then wakes on the next one', async () => {
    const ticketId = makeTicket();
    const decisionId = seedMerge(ticketId, { weaverReviewedHeadSha: null });

    const first = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(first).toEqual({ woken: false, decisionId });
    expect(h.db.get('SELECT weaver_reviewed_head_sha AS h FROM decisions WHERE id = ?', [decisionId])!.h).toBe(MOVED);
    expect(heldKeys()).toHaveLength(0);

    const second = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED_AGAIN);
    expect(second.woken).toBe(true);
    expect(heldKeys()).toEqual([`held-review:${decisionId}:${MOVED_AGAIN}`]);
  });

  it('does nothing when the ticket carries no held merge approval', async () => {
    const ticketId = makeTicket();

    const result = await tickets.noteHeldReviewHead(SYSTEM, ticketId, MOVED);

    expect(result.woken).toBe(false);
    expect(heldKeys()).toHaveLength(0);
  });

  describe('deliveryHead', () => {
    it('reads the worker branch head from a real worktree', async () => {
      const ticketId = makeTicket();
      const dir = join(h.root, 'ticket-worktree');
      mkdirSync(dir, { recursive: true });
      await git(['init'], dir);
      writeFileSync(join(dir, 'file.txt'), 'hello');
      await git(['add', '.'], dir);
      await git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'fix'], dir);
      const head = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
      h.db.insert('worktrees', {
        id: newId(), projectId: h.projectId, ticketId, agentId: null, provider: 'git', path: dir, branch: 'ac/test',
        status: 'active', createdAt: nowIso(),
      });

      expect(await tickets.deliveryHead(ticketId)).toBe(head);
    });

    it('returns null when nothing can be resolved', async () => {
      const ticketId = makeTicket();

      expect(await tickets.deliveryHead(ticketId)).toBeNull();
    });
  });
});
