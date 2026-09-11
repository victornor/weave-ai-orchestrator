import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OcError, type Wakeup } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRoutinesService } from './index.js';
import { recordUsage } from '../usage/service.js';
import type { Actor, RoutinesService } from '../api.js';
import { createTicketsService } from '../tickets/service.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };

function dailyTrigger(hour = 7, timezone = 'UTC') {
  return { kind: 'schedule' as const, timezone, daily: { hour, minute: 0 } };
}

describe('routines (VS-220)', () => {
  let h: TestHarness;
  let routines: RoutinesService;

  beforeEach(() => {
    h = makeHarness();
    h.services.wake = createWakeService(h.ctx, h.deps);
    h.services.workers = { conductor: () => ({ id: h.conductorId }) } as never;
    h.services.projects = { get: (id: string) => { if (id === h.projectId) return { id }; throw new OcError('not_found', `project ${id} not found`); } } as never;
    routines = createRoutinesService(h.ctx, h.deps);
    h.services.routines = routines;
  });
  afterEach(() => h.cleanup());

  const add = (over: Partial<Parameters<RoutinesService['create']>[1]> = {}) =>
    routines.create(HUMAN, {
      name: 'Morning review',
      trigger: dailyTrigger(),
      instruction: 'Look at yesterday\'s incidents and report.',
      ...over,
    });

  it('defaults action to report and maxTicketsPerFire to 0', () => {
    const r = add();
    expect(r.template.action).toBe('report');
    expect(r.template.maxTicketsPerFire).toBe(0);
    expect(r.status).toBe('active');
    expect(r.nextFireAt).toBeTruthy();
    expect(r.roleId).toBeNull();
    expect(r.concurrency).toBe('skip_if_active');
  });

  it('defaults file_work cap to 3 and rejects cap > 8 and webhook/cron', () => {
    expect(add({ action: 'file_work' }).template.maxTicketsPerFire).toBe(3);
    expect(() => add({ maxTicketsPerFire: 9 })).toThrow(/maxTicketsPerFire/);
    expect(() => add({ trigger: { kind: 'webhook' } })).toThrow(/webhook/);
    expect(() => add({ trigger: { kind: 'schedule', timezone: 'UTC', cron: '* * * * *' } })).toThrow(/cron/);
  });

  it('stores an edited instruction', () => {
    const r = add();
    const next = routines.update(HUMAN, r.id, { instruction: 'Check the merge queue instead.' });
    expect(next.template.instruction).toBe('Check the merge queue instead.');
    expect(routines.get(r.id).template.instruction).toBe('Check the merge queue instead.');
  });

  it('pause does not fire; resume arms a future slot; remove deletes', () => {
    const r = add();
    h.ctx.db.update('routines', r.id, { nextFireAt: '2020-01-01T00:00:00.000Z' });
    routines.update(HUMAN, r.id, { status: 'paused' });
    expect(routines.fireDue('2026-09-11T10:00:00.000Z')).toEqual([]);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups WHERE source = 'routine'")).toHaveLength(0);

    const resumed = routines.update(HUMAN, r.id, { status: 'active' });
    expect(resumed.status).toBe('active');
    expect(resumed.nextFireAt! > '2026-09-11T10:00:00.000Z' || Date.parse(resumed.nextFireAt!) > Date.now() - 60_000).toBe(true);

    routines.remove(HUMAN, r.id);
    expect(() => routines.get(r.id)).toThrow(OcError);
    expect(routines.list()).toEqual([]);
  });

  it('a due routine produces exactly one conductor wake with source routine', () => {
    const r = add();
    h.ctx.db.update('routines', r.id, { nextFireAt: '2026-09-11T07:00:00.000Z' });
    const fired = routines.fireDue('2026-09-11T07:00:05.000Z');
    expect(fired).toHaveLength(1);
    const wakes = h.db.all<Wakeup>("SELECT * FROM wakeups");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ source: 'routine', agentId: h.conductorId, status: 'queued' });
    expect(wakes[0]!.payload).toMatchObject({
      routineId: r.id, name: 'Morning review', action: 'report', instruction: "Look at yesterday's incidents and report.",
    });
    expect(fired[0]!.inFlightWakeId).toBe(wakes[0]!.id);
    expect(fired[0]!.lastFiredAt).toBe('2026-09-11T07:00:05.000Z');
    expect(fired[0]!.nextFireAt).toBe('2026-09-12T07:00:00.000Z');
  });

  it('missed fire: Monday 07:00 due, fireDue Wednesday 10:00 → one wake and Thursday 07:00 next', () => {
    const r = add({ trigger: dailyTrigger(7, 'UTC') });
    h.ctx.db.update('routines', r.id, { nextFireAt: '2026-09-07T07:00:00.000Z' }); // Monday
    const wednesday = '2026-09-09T10:00:00.000Z';
    expect(routines.fireDue(wednesday)).toHaveLength(1);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups WHERE source = 'routine'")).toHaveLength(1);
    expect(routines.get(r.id).nextFireAt).toBe('2026-09-10T07:00:00.000Z'); // Thursday
    expect(routines.fireDue('2026-09-09T10:01:00.000Z')).toHaveLength(0);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups WHERE source = 'routine'")).toHaveLength(1);
  });

  it('overlap: in-flight wake blocks a later slot; finalize snaps next_fire_at without enqueueing', () => {
    const r = add({ trigger: { kind: 'schedule', timezone: 'UTC', everyMinutes: 15 } });
    h.ctx.db.update('routines', r.id, { nextFireAt: '2026-09-11T10:00:00.000Z' });
    expect(routines.fireDue('2026-09-11T10:00:01.000Z')).toHaveLength(1);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups")).toHaveLength(1);
    const after = routines.get(r.id);
    expect(after.inFlightWakeId).toBeTruthy();
    // Advance past the next slot while the first wake is still queued.
    expect(routines.fireDue('2026-09-11T10:20:00.000Z')).toHaveLength(0);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups")).toHaveLength(1);

    const wake = h.db.get<Wakeup>('SELECT * FROM wakeups')!;
    routines.onRunFinalized([wake], '2026-09-11T10:20:00.000Z');
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups")).toHaveLength(1);
    const snapped = routines.get(r.id);
    expect(snapped.inFlightWakeId).toBeNull();
    expect(snapped.nextFireAt! > '2026-09-11T10:20:00.000Z').toBe(true);
  });

  it('paused conductor skip does not advance next_fire_at or set in-flight', () => {
    const r = add();
    h.ctx.db.update('routines', r.id, { nextFireAt: '2026-09-11T07:00:00.000Z' });
    h.ctx.db.update('agents', h.conductorId, { status: 'paused' });
    expect(routines.fireDue('2026-09-11T07:00:05.000Z')).toHaveLength(0);
    const skipped = h.db.all<Wakeup>("SELECT * FROM wakeups");
    expect(skipped.every((w) => w.status === 'skipped')).toBe(true);
    const held = routines.get(r.id);
    expect(held.nextFireAt).toBe('2026-09-11T07:00:00.000Z');
    expect(held.inFlightWakeId).toBeNull();

    h.ctx.db.update('agents', h.conductorId, { status: 'active' });
    expect(routines.fireDue('2026-09-11T07:00:10.000Z')).toHaveLength(1);
    expect(h.db.all<Wakeup>("SELECT * FROM wakeups WHERE status = 'queued'")).toHaveLength(1);
  });

  it('usage is zero until a fire records spend, then includes the fire and an originated ticket', () => {
    const r = add();
    expect(routines.usage(r.id, '7d', new Date('2026-09-11T12:00:00.000Z'))).toMatchObject({
      tokensIn: 0, tokensOut: 0, runs: 0, costCents: 0, window: '7d',
    });
    h.ctx.db.update('routines', r.id, { nextFireAt: '2026-09-11T07:00:00.000Z' });
    routines.fireDue('2026-09-11T07:00:05.000Z');
    const wake = h.db.get<Wakeup>("SELECT * FROM wakeups WHERE source = 'routine'")!;
    const runId = 'run-fire';
    h.ctx.db.insert('runs', {
      id: runId, workspaceId: h.workspaceId, agentId: h.conductorId, wakeupIdsJson: [wake.id], runtimeId: 'claude',
      turnEpoch: 1, cwd: h.ctx.paths.conductor, createdAt: '2026-09-11T07:00:06.000Z',
    });
    h.ctx.db.update('wakeups', wake.id, { runId, status: 'claimed' });
    recordUsage(h.ctx, {
      agentId: h.conductorId, runId, runtimeId: 'claude', inputTokens: 100, outputTokens: 20, costCents: 5,
      occurredAt: '2026-09-11T07:01:00.000Z',
    });
    h.services.tickets = createTicketsService(h.ctx, h.deps);
    const child = h.services.tickets.create(HUMAN, {
      kind: 'scout', title: 'Look at one incident', projectId: h.projectId,
      originKind: 'routine', originFingerprint: `routine:${r.id}:inc-1`,
    });
    recordUsage(h.ctx, {
      agentId: h.conductorId, runId: 'run-child', runtimeId: 'claude', ticketId: child.id,
      inputTokens: 50, outputTokens: 10, costCents: 3, occurredAt: '2026-09-11T08:00:00.000Z',
    });
    const u = routines.usage(r.id, '7d', new Date('2026-09-11T12:00:00.000Z'));
    expect(u.tokensIn).toBe(150);
    expect(u.tokensOut).toBe(30);
    expect(u.costCents).toBe(8);
    expect(u.runs).toBe(2);
  });
});
