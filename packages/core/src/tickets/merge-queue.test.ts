import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import type { Ticket } from '@weave-ai/shared';
import { makeHarness, fakeWake, fakeSpecs, type TestHarness } from '../testing/context.js';
import { createTicketsService } from './service.js';
import type { Actor, TicketsService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const AGENT: Actor = { kind: 'agent', id: 'agent-1', runId: 'run-1' };

describe('merge queue', () => {
  let h: TestHarness;
  let tickets: TicketsService;
  let wake: ReturnType<typeof fakeWake>;
  let workers: { spawnForTicket: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h = makeHarness();
    wake = fakeWake();
    workers = { spawnForTicket: vi.fn(async (_actor: Actor, ticketId: string) => ({ id: h.addWorker(ticketId) })) };
    h.services.wake = wake as never;
    h.services.workers = workers as never;
    h.services.decisions = { create: vi.fn(() => ({ id: newId() })), supersedeForTarget: vi.fn(() => 0), withdrawForTicket: vi.fn(() => 0) } as never;
    h.services.openspec = {
      validateForProposed: vi.fn(async () => ({ ok: true as const, plan: '# Plan' })),
      archiveAfterMerge: vi.fn(async () => ({ archivedAs: null, skipped: 'no change' })),
    } as never;
    h.services.specs = fakeSpecs() as never;
    tickets = createTicketsService(h.ctx, h.deps);
    h.services.tickets = tickets;
  });
  afterEach(async () => { await tickets.stop(); h.cleanup(); });

  /** A ticket sitting in `in_review` with an answered merge approval, so `merging` is reachable. */
  function approved(title: string, opts: { worker?: boolean } = {}): Ticket {
    const t = tickets.create(HUMAN, { kind: 'change', title, projectId: h.projectId, assigneeRoleId: h.roleId });
    tickets.addWorkProduct(AGENT, t.id, { type: 'pull_request', url: `https://example.com/${title}` });
    h.db.update('tickets', t.id, { status: 'in_review' });
    h.db.insert('decisions', {
      id: newId(), workspaceId: h.workspaceId, ticketId: t.id, kind: 'merge_approval', owner: 'human', title: 'Merge?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'answered', answerKey: 'approve', createdAt: nowIso(),
    });
    if (opts.worker !== false) h.addWorker(t.id);
    return tickets.get(t.id);
  }

  const approve = (t: Ticket): Promise<Ticket> => tickets.transition(HUMAN, t.id, { to: 'merging' });
  const setLimit = (n: number): unknown => h.db.update('projects', h.projectId, { policiesJson: { mergeConcurrency: n } });
  const mergeWakes = (ticketId: string): number =>
    wake.calls.filter((c) => c.input.source === 'merge_approved' && (c.input.payload as { ticketId?: string })?.ticketId === ticketId).length;

  describe('joining and admission', () => {
    it('admits the first approved ticket of an idle project and wakes its worker once', async () => {
      const a = approved('First');
      const after = await approve(a);
      expect(after.status).toBe('merging');
      expect(after.mergeQueuedAt).not.toBeNull();
      expect(after.mergeStartedAt).not.toBeNull();
      expect(mergeWakes(a.id)).toBe(1);
    });

    it('leaves later tickets waiting with no wake while one is merging', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      const afterB = await approve(b);

      expect(afterB.status).toBe('merging');
      expect(afterB.mergeQueuedAt).not.toBeNull();
      expect(afterB.mergeStartedAt).toBeNull();
      expect(mergeWakes(b.id)).toBe(0);

      const view = tickets.mergeQueue.forProject(h.projectId);
      expect(view.concurrency).toBe(1);
      expect(view.active.map((e) => e.ticketId)).toEqual([a.id]);
      expect(view.waiting.map((e) => [e.ticketId, e.position])).toEqual([[b.id, 1]]);
    });

    it('does not move a ticket already in the queue when the queue is pumped again', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      await approve(b);
      const joinedAt = tickets.get(b.id).mergeQueuedAt;
      await tickets.mergeQueue.pump(h.projectId);
      await tickets.mergeQueue.pump(h.projectId);
      expect(tickets.get(b.id).mergeQueuedAt).toBe(joinedAt);
      expect(tickets.mergeQueue.positionOf(b.id)).toBe(1);
    });

    it('admits a ticket with no project immediately', async () => {
      const t = tickets.create(HUMAN, { kind: 'task', title: 'Loose', projectId: null, assigneeRoleId: null });
      tickets.addWorkProduct(AGENT, t.id, { type: 'branch', title: 'ac/loose' });
      h.db.update('tickets', t.id, { status: 'in_review', autoMerge: 1 });
      const after = await tickets.transition(HUMAN, t.id, { to: 'merging' });
      expect(after.mergeStartedAt).not.toBeNull();
    });
  });

  describe('ordering', () => {
    it('admits in join order, breaking ties on the ticket number', async () => {
      const a = approved('First');
      const b = approved('Second');
      const c = approved('Third');
      await approve(a);
      await approve(b);
      await approve(c);
      // b and c joined within the same clock tick: the lower number goes first.
      const sameMoment = nowIso();
      h.db.update('tickets', b.id, { mergeQueuedAt: sameMoment });
      h.db.update('tickets', c.id, { mergeQueuedAt: sameMoment });

      expect(tickets.mergeQueue.forProject(h.projectId).waiting.map((e) => e.ticketId)).toEqual([b.id, c.id]);
      expect(tickets.mergeQueue.positionOf(b.id)).toBe(1);
      expect(tickets.mergeQueue.positionOf(c.id)).toBe(2);
    });

    it('reports an empty queue with the project limit for a project with nothing merging', () => {
      setLimit(3);
      const view = tickets.mergeQueue.forProject(h.projectId);
      expect(view).toMatchObject({ projectId: h.projectId, concurrency: 3, active: [], waiting: [] });
    });

    it('reports no position for a ticket that is merging rather than waiting', async () => {
      const a = approved('First');
      await approve(a);
      expect(tickets.mergeQueue.positionOf(a.id)).toBeNull();
    });
  });

  describe('the concurrency limit', () => {
    it('lands one at a time by default', async () => {
      const ts = [approved('One'), approved('Two'), approved('Three')];
      for (const t of ts) await approve(t);
      const view = tickets.mergeQueue.forProject(h.projectId);
      expect(view.active).toHaveLength(1);
      expect(view.waiting).toHaveLength(2);
    });

    it('admits up to a raised limit', async () => {
      setLimit(2);
      const ts = [approved('One'), approved('Two'), approved('Three')];
      for (const t of ts) await approve(t);
      const view = tickets.mergeQueue.forProject(h.projectId);
      expect(view.active.map((e) => e.ticketId)).toEqual([ts[0]!.id, ts[1]!.id]);
      expect(view.waiting.map((e) => e.ticketId)).toEqual([ts[2]!.id]);
    });

    it('never exceeds the limit however often it is pumped', async () => {
      const ts = [approved('One'), approved('Two'), approved('Three')];
      for (const t of ts) await approve(t);
      await tickets.mergeQueue.pump(h.projectId);
      await tickets.mergeQueue.pumpAll();
      expect(tickets.mergeQueue.forProject(h.projectId).active).toHaveLength(1);
    });
  });

  describe('leaving the queue', () => {
    it('advances the queue when the merging ticket lands', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      await approve(b);

      await tickets.mergeDone(AGENT, a.id, { mergeCommit: 'abc1234', method: 'squash' });

      const done = tickets.get(a.id);
      expect(done.status).toBe('done');
      expect(done.mergeQueuedAt).toBeNull();
      expect(done.mergeStartedAt).toBeNull();
      expect(tickets.get(b.id).mergeStartedAt).not.toBeNull();
      expect(mergeWakes(b.id)).toBe(1);
    });

    it('advances the queue when the merging ticket fails and is blocked', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      await approve(b);

      const blocked = await tickets.transition(AGENT, a.id, {
        to: 'blocked', unblock: { owner: 'weaver', action: 'conflict in schema.sql needs a decision' },
      });

      expect(blocked.status).toBe('blocked');
      expect(blocked.mergeQueuedAt).toBeNull();
      expect(blocked.mergeStartedAt).toBeNull();
      expect(blocked.unblock).toMatchObject({ owner: 'weaver' });
      expect(tickets.get(b.id).mergeStartedAt).not.toBeNull();
      expect(mergeWakes(b.id)).toBe(1);
    });

    it('advances the queue when the merging ticket is sent back for changes', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      await approve(b);

      await tickets.transition(AGENT, a.id, { to: 'in_review' });

      expect(tickets.get(a.id).mergeStartedAt).toBeNull();
      expect(tickets.get(b.id).mergeStartedAt).not.toBeNull();
    });
  });

  describe('recent outcomes', () => {
    const recent = (): Array<{ identifier: string; outcome: string }> =>
      tickets.mergeQueue.recentOf(h.projectId).map((r) => ({ identifier: r.identifier, outcome: r.outcome }));

    it('reports a landed ticket with the commit its merge produced', async () => {
      const a = approved('First');
      await approve(a);

      await tickets.mergeDone(AGENT, a.id, { mergeCommit: 'abc1234', method: 'squash' });

      const rows = tickets.mergeQueue.recentOf(h.projectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ticketId: a.id, identifier: a.identifier, outcome: 'landed', mergeCommit: 'abc1234' });
      expect(rows[0]?.at).toEqual(expect.any(String));
    });

    it('reports a merge that could not complete as failed', async () => {
      const a = approved('First');
      await approve(a);

      await tickets.transition(AGENT, a.id, { to: 'blocked', unblock: { owner: 'weaver', action: 'unresolvable conflict' } });

      expect(recent()).toEqual([{ identifier: a.identifier, outcome: 'failed' }]);
    });

    it('reports a ticket sent back for changes as neither landed nor failed', async () => {
      const a = approved('First');
      await approve(a);

      await tickets.transition(AGENT, a.id, { to: 'in_review' });

      expect(recent()).toEqual([{ identifier: a.identifier, outcome: 'withdrawn' }]);
    });

    it('ignores a transition that never went through the queue', async () => {
      const a = approved('First');
      await tickets.transition(HUMAN, a.id, { to: 'in_progress' });

      expect(recent()).toEqual([]);
    });

    it('reports the most recent first and no more than the limit', async () => {
      const landed: string[] = [];
      for (const title of ['First', 'Second', 'Third']) {
        const t = approved(title);
        await approve(t);
        await tickets.mergeDone(AGENT, t.id, { mergeCommit: title.toLowerCase() });
        landed.push(tickets.get(t.id).identifier);
      }

      expect(recent().map((r) => r.identifier)).toEqual([...landed].reverse());
      expect(tickets.mergeQueue.recentOf(h.projectId, 2).map((r) => r.identifier)).toEqual([...landed].reverse().slice(0, 2));
    });

    it('reports an empty list for a project whose queue has never held anything', () => {
      expect(tickets.mergeQueue.recentOf(h.projectId)).toEqual([]);
      expect(tickets.mergeQueue.forProject(h.projectId)).toMatchObject({ active: [], waiting: [], recent: [] });
    });
  });

  describe('workers', () => {
    it('spawns no worker for a ticket that is waiting', async () => {
      const a = approved('First');
      await approve(a);
      const b = approved('Second', { worker: false });
      await approve(b);
      expect(workers.spawnForTicket).not.toHaveBeenCalled();
      expect(tickets.get(b.id).workerId).toBeNull();
    });

    it('brings a worker back when the ticket is admitted', async () => {
      const a = approved('First');
      const b = approved('Second', { worker: false });
      await approve(a);
      await approve(b);

      await tickets.mergeDone(AGENT, a.id, { mergeCommit: 'abc1234' });

      expect(workers.spawnForTicket).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system' }), b.id);
      expect(tickets.get(b.id).mergeStartedAt).not.toBeNull();
      expect(mergeWakes(b.id)).toBe(1);
    });

    it('holds the head of the queue when no worker can be brought', async () => {
      const a = approved('First');
      const b = approved('Second', { worker: false });
      const c = approved('Third');
      await approve(a);
      await approve(b);
      await approve(c);
      workers.spawnForTicket.mockRejectedValueOnce(Object.assign(new Error('role is full'), { code: 'role_full' }));

      await tickets.mergeDone(AGENT, a.id, { mergeCommit: 'abc1234' });

      expect(tickets.get(b.id).mergeStartedAt).toBeNull();
      expect(tickets.get(c.id).mergeStartedAt).toBeNull();
      expect(tickets.mergeQueue.positionOf(b.id)).toBe(1);
    });
  });

  describe('liveness', () => {
    it('does not report a waiting ticket as a liveness violation', async () => {
      const a = approved('First');
      const b = approved('Second');
      await approve(a);
      await approve(b);
      // Neither worker has a live run or a queued wake left.
      h.db.run("UPDATE wakeups SET status = 'completed'");

      const violations = tickets.livenessViolations().map((t) => t.id);
      expect(violations).not.toContain(b.id);
      expect(violations).toContain(a.id);
    });
  });

  describe('upgrade', () => {
    it('treats a ticket that was already merging before the columns existed as first in line', async () => {
      const a = approved('Legacy');
      const b = approved('Second');
      h.db.update('tickets', a.id, { status: 'merging', mergeQueuedAt: null, mergeStartedAt: null, updatedAt: '2020-01-01T00:00:00.000Z' });
      await approve(b);

      expect(tickets.get(a.id).mergeStartedAt).not.toBeNull();
      expect(tickets.get(b.id).mergeStartedAt).toBeNull();
    });
  });
});
