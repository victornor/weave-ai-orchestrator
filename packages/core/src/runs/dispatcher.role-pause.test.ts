/**
 * VS-154: a paused role holds the turn, not the wake. The dispatcher must not claim a worker
 * whose role is paused (same as the login gate); resume lets the queued wake start.
 */
import { newId, nowIso } from '@agent-conductor/db';
import { FakeRuntime } from '@agent-conductor/runtime-sdk';
import type { Run, Wakeup } from '@agent-conductor/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

const idle = { structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } };

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;

function setup(): void {
  h = makeHarness();
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { conductor: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null } };
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
  runtime.queue.push(idle);
}

afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

function seedTicket(over: Record<string, unknown> = {}): string {
  const id = newId();
  const now = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
    title: 'Do the thing', description: 'Do it.', status: 'proposed', priority: 'medium',
    assigneeRoleId: h.roleId, createdByKind: 'human', createdAt: now, updatedAt: now, ...over,
  });
  return id;
}

const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;
const runCountFor = (agentId: string): number => h.db.all<Run>('SELECT id FROM runs WHERE agent_id = ?', [agentId]).length;

describe('dispatcher does not claim a worker whose role is paused (VS-154)', () => {
  it('leaves the wake queued until the role is active, then claims it', async () => {
    setup();
    const ticketId = seedTicket();
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
    h.db.update('roles', h.roleId, { status: 'paused' });
    const w = h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'plan approved for TST-1', payload: { ticketId } });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(0);
    expect(wakeStatus(w.id)).toBe('queued');

    h.db.update('roles', h.roleId, { status: 'active' });
    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(1);
    expect(wakeStatus(w.id)).not.toBe('queued');
  });

  it('starts apply after pause → plan approved → resume', async () => {
    setup();
    const ticketId = seedTicket({ status: 'proposed' });
    const workerId = h.addWorker(ticketId, { runtimeId: 'fake', worktreePath: null });
    h.db.update('roles', h.roleId, { status: 'paused' });

    const w = h.services.wake!.enqueue(workerId, {
      source: 'ticket_assigned', reason: 'plan approved for TST-1', payload: { ticketId },
    });
    h.db.update('tickets', ticketId, { status: 'approved', workerId, updatedAt: nowIso() });

    await dispatcher.tick();
    await dispatcher.drain();
    expect(w.status).toBe('queued');
    expect(runCountFor(workerId)).toBe(0);

    h.db.update('roles', h.roleId, { status: 'active', pauseReason: null });
    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(1);
    expect(h.db.get<Run>('SELECT * FROM runs WHERE agent_id = ?', [workerId])!.status).not.toBe('queued');
  });

  it('starts apply on runtime B after propose on A and a runtime switch', async () => {
    setup();
    const runtimeA = new FakeRuntime();
    const runtimeB = new FakeRuntime();
    h.ctx.registries.runtimes.set('runtime-a', runtimeA);
    h.ctx.registries.runtimes.set('runtime-b', runtimeB);
    h.ctx.config.models = { conductor: { runtime: 'runtime-a', model: null }, workers: { runtime: 'runtime-a', model: null } };
    runtimeB.queue.push(idle);

    const ticketId = seedTicket();
    const workerId = h.addWorker(ticketId, { runtimeId: 'runtime-a', worktreePath: null });
    const sessionA = newId();
    h.db.insert('agent_sessions', {
      id: sessionA, agentId: workerId, runtimeId: 'runtime-a',
      sessionRefJson: { sessionId: 'from-a' }, displayId: null, status: 'active', turnCount: 1,
      cumulativeUsageJson: {}, createdAt: nowIso(), updatedAt: nowIso(),
    });

    h.ctx.config.models.workers = { runtime: 'runtime-b', model: null };
    h.services.wake!.enqueue(workerId, { source: 'ticket_assigned', reason: 'plan approved for TST-1', payload: { ticketId } });

    await dispatcher.tick();
    await dispatcher.drain();

    const run = h.db.get<Run>('SELECT * FROM runs WHERE agent_id = ?', [workerId])!;
    expect(run).toBeTruthy();
    expect(run.runtimeId).toBe('runtime-b');
    expect(h.db.get<{ status: string }>('SELECT status FROM agent_sessions WHERE id = ?', [sessionA])!.status).toBe('stale');
    expect(runtimeB.inputs.at(-1)!.session.ref).not.toEqual({ sessionId: 'from-a' });
    expect(runtimeA.inputs).toHaveLength(0);
  });
});
