import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from './index.js';
import type { WakeService } from '../api.js';

const tick = () => new Promise((r) => setImmediate(r));

describe('wake queue', () => {
  let h: TestHarness;
  let wake: WakeService;

  beforeEach(() => {
    h = makeHarness();
    wake = createWakeService(h.ctx, h.deps);
  });
  afterEach(() => h.cleanup());

  it('queues a wake and emits wake.queued', async () => {
    const w = wake.enqueue(h.conductorId, { source: 'human_message', reason: 'hello' });
    expect(w.status).toBe('queued');
    await tick();
    expect(h.events.some((e) => e.type === 'wake.queued')).toBe(true);
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(1);
  });

  it('coalesces into the queued wake, appending payloads to the bundle', () => {
    const first = wake.enqueue(h.conductorId, { source: 'human_message', reason: 'one', payload: { a: 1 } });
    const second = wake.enqueue(h.conductorId, { source: 'ticket_comment', reason: 'two', payload: { b: 2 } });
    expect(second.status).toBe('coalesced');
    expect(second.coalescedIntoId).toBe(first.id);
    const queued = wake.listForAgent(h.conductorId, ['queued']);
    expect(queued).toHaveLength(1);
    const bundle = (queued[0]!.payload as { bundle: Array<{ source: string; reason: string }> }).bundle;
    expect(bundle).toHaveLength(1);
    expect(bundle[0]).toMatchObject({ source: 'ticket_comment', reason: 'two' });
  });

  it('carries requestedBy into the bundle entry (VS-143: an isolated daemon\'s dispatch gate needs it)', () => {
    wake.enqueue(h.conductorId, { source: 'system', reason: 'one', requestedBy: { kind: 'system', id: null } });
    wake.enqueue(h.conductorId, { source: 'human_message', reason: 'two', requestedBy: { kind: 'human', id: 'u1' } });
    const queued = wake.listForAgent(h.conductorId, ['queued']);
    const bundle = (queued[0]!.payload as { bundle: Array<{ requestedByKind: string; requestedById: string | null }> }).bundle;
    expect(bundle[0]).toMatchObject({ requestedByKind: 'human', requestedById: 'u1' });
  });

  it('defaults a bundled entry with no requestedBy to system', () => {
    wake.enqueue(h.conductorId, { source: 'system', reason: 'one' });
    wake.enqueue(h.conductorId, { source: 'system', reason: 'two' });
    const queued = wake.listForAgent(h.conductorId, ['queued']);
    const bundle = (queued[0]!.payload as { bundle: Array<{ requestedByKind: string; requestedById: string | null }> }).bundle;
    expect(bundle[0]).toMatchObject({ requestedByKind: 'system', requestedById: null });
  });

  it('skips a paused agent with a skip reason and records a skipped row', async () => {
    h.db.update('agents', h.conductorId, { status: 'paused' });
    const w = wake.enqueue(h.conductorId, { source: 'timer', reason: 'tick' });
    expect(w.status).toBe('skipped');
    expect(w.skipReason).toBe('agent_paused');
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(0);
    await tick();
    expect(h.events.some((e) => e.type === 'wake.skipped')).toBe(true);
  });

  it('queues a worker whose role is paused (VS-154: the dispatcher holds the turn)', () => {
    const workerId = h.addWorker(null);
    h.db.update('roles', h.roleId, { status: 'paused' });
    const w = wake.enqueue(workerId, { source: 'ticket_comment', reason: 'x' });
    expect(w.status).toBe('queued');
    expect(w.skipReason).toBeNull();
  });

  it('still skips a worker whose role is retired', () => {
    const workerId = h.addWorker(null);
    h.db.update('roles', h.roleId, { status: 'retired' });
    expect(wake.enqueue(workerId, { source: 'ticket_comment', reason: 'x' }).skipReason).toBe('role_retired');
  });

  it('skips when the workspace is not active', () => {
    h.db.update('workspaces', h.workspaceId, { status: 'paused' });
    expect(wake.enqueue(h.conductorId, { source: 'system', reason: 'x' }).skipReason).toBe('workspace_paused');
  });

  it('is idempotent on the idempotency key', () => {
    const a = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness', idempotencyKey: 'k1' });
    const b = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness again', idempotencyKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(1);
  });

  it('does not let a skipped wake consume its idempotency key (VS-154)', () => {
    h.db.update('agents', h.conductorId, { status: 'paused' });
    const skipped = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness', idempotencyKey: 'k1' });
    expect(skipped.status).toBe('skipped');
    expect(skipped.skipReason).toBe('agent_paused');
    h.db.update('agents', h.conductorId, { status: 'active' });
    const queued = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness again', idempotencyKey: 'k1' });
    expect(queued.status).toBe('queued');
    expect(queued.id).not.toBe(skipped.id);
  });

  it('still returns a completed wake for the same idempotency key', () => {
    const a = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness', idempotencyKey: 'k1' });
    h.db.update('wakeups', a.id, { status: 'completed', finishedAt: nowIso() });
    const b = wake.enqueue(h.conductorId, { source: 'system', reason: 'liveness again', idempotencyKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(0);
  });

  it('does not coalesce into a wake that is not due yet', () => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    const delayed = wake.enqueue(h.conductorId, { source: 'retry', reason: 'later', notBefore: later });
    const now = wake.enqueue(h.conductorId, { source: 'human_message', reason: 'now' });
    expect(delayed.status).toBe('queued');
    expect(now.status).toBe('queued');
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(2);
  });

  it('cancels queued wakes for an agent', () => {
    wake.enqueue(h.conductorId, { source: 'human_message', reason: 'one' });
    expect(wake.cancelForAgent(h.conductorId, 'stopping')).toBe(1);
    expect(wake.listForAgent(h.conductorId, ['queued'])).toHaveLength(0);
  });

  it('rejects an unknown agent', () => {
    expect(() => wake.enqueue(newId(), { source: 'system', reason: 'x' })).toThrow(/not found/);
  });

  it('does not coalesce across agents', () => {
    const workerId = h.addWorker(null);
    wake.enqueue(h.conductorId, { source: 'human_message', reason: 'c' });
    const w = wake.enqueue(workerId, { source: 'ticket_assigned', reason: 'w' });
    expect(w.status).toBe('queued');
    expect(nowIso()).toBeTruthy();
  });

  it('schedules a self-wake twenty minutes out, carrying the reason and a notBefore', () => {
    const workerId = h.addWorker(null);
    const before = Date.now();
    const w = wake.scheduleSelfWake(workerId, { reason: 'check the sweep', delayMs: 20 * 60_000 });
    expect(w.source).toBe('self_scheduled');
    expect(w.status).toBe('queued');
    expect(w.reason).toBe('check the sweep');
    const at = Date.parse(w.notBefore!);
    expect(at).toBeGreaterThanOrEqual(before + 20 * 60_000 - 2_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 20 * 60_000 + 2_000);
    expect(wake.pendingSelfWake(workerId)?.id).toBe(w.id);
  });

  it('replaces the pending self-wake rather than stacking a second (VS-317)', () => {
    const workerId = h.addWorker(null);
    const first = wake.scheduleSelfWake(workerId, { reason: 'first', delayMs: 20 * 60_000 });
    const second = wake.scheduleSelfWake(workerId, { reason: 'second', delayMs: 30 * 60_000 });
    expect(second.id).not.toBe(first.id);
    const queued = wake.listForAgent(workerId, ['queued']).filter((w) => w.source === 'self_scheduled');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(second.id);
    expect(queued[0]!.reason).toBe('second');
    const cancelled = wake.listForAgent(workerId, ['cancelled']).filter((w) => w.id === first.id);
    expect(cancelled).toHaveLength(1);
    expect(wake.pendingSelfWake(workerId)?.id).toBe(second.id);
  });

  it('replaces a self-wake already claimed for the current turn (VS-391)', () => {
    const workerId = h.addWorker(null);
    const first = wake.scheduleSelfWake(workerId, { reason: 'first', delayMs: 20 * 60_000 });
    h.db.update('wakeups', first.id, { status: 'claimed', claimedAt: nowIso() });
    const second = wake.scheduleSelfWake(workerId, { reason: 'second', delayMs: 30 * 60_000 });
    expect(second.id).not.toBe(first.id);
    const queued = wake.listForAgent(workerId, ['queued']).filter((w) => w.source === 'self_scheduled');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(second.id);
    expect(wake.pendingSelfWake(workerId)?.id).toBe(second.id);
  });

  it('replaces a self-wake already finished, releasing its key (VS-391)', () => {
    const workerId = h.addWorker(null);
    const first = wake.scheduleSelfWake(workerId, { reason: 'first', delayMs: 20 * 60_000 });
    h.db.update('wakeups', first.id, { status: 'completed', finishedAt: nowIso() });
    const second = wake.scheduleSelfWake(workerId, { reason: 'second', delayMs: 30 * 60_000 });
    expect(second.id).not.toBe(first.id);
    expect(wake.pendingSelfWake(workerId)?.id).toBe(second.id);
    const firstRow = h.db.get<{ idempotencyKey: string | null; status: string }>('SELECT idempotency_key, status FROM wakeups WHERE id = ?', [first.id]);
    expect(firstRow!.idempotencyKey).toBeNull();
    expect(firstRow!.status).toBe('completed');
  });

  it('rejects a self-wake shorter than the minimum or longer than the maximum', () => {
    const workerId = h.addWorker(null);
    expect(() => wake.scheduleSelfWake(workerId, { reason: 'too soon', delayMs: 1_000 })).toThrow(/at least/);
    expect(() => wake.scheduleSelfWake(workerId, { reason: 'too far', delayMs: 25 * 60 * 60_000 })).toThrow(/at most/);
    expect(wake.listForAgent(workerId, ['queued'])).toHaveLength(0);
  });

  it('reports no pending self-wake once the scheduled one is claimed', () => {
    const workerId = h.addWorker(null);
    const w = wake.scheduleSelfWake(workerId, { reason: 'later', delayMs: 5 * 60_000 });
    expect(wake.pendingSelfWake(workerId)?.id).toBe(w.id);
    h.db.update('wakeups', w.id, { status: 'claimed' });
    expect(wake.pendingSelfWake(workerId)).toBeNull();
  });

  it('always schedules for the named agent, never another', () => {
    const a = h.addWorker(null);
    const b = h.addWorker(null);
    const w = wake.scheduleSelfWake(a, { reason: 'mine', delayMs: 5 * 60_000 });
    expect(w.agentId).toBe(a);
    expect(wake.pendingSelfWake(b)).toBeNull();
  });
});
