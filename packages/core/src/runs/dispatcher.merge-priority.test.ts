/**
 * VS-464: an admitted merge holds a whole project's merge slot, so its worker must not wait behind an
 * ordinary development turn for a free run slot. The dispatcher's fairness order (`last_run_at`) would
 * otherwise start a never-run worker first; a queued `merge_approved` wake lifts the merge slot holder
 * above it. With no merge wake the ordinary order is unchanged. The 6-run cap still bounds
 * concurrency — this only decides who takes the next slot that frees.
 */
import { nowIso } from '@weave-ai/db';
import { FakeRuntime, type TurnResult } from '@weave-ai/runtime-sdk';
import type { Run, Wakeup } from '@weave-ai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

const IDLE = { structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } };

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;
let release: (() => void) | undefined;

function setup(): void {
  h = makeHarness();
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  // One slot only, so the weaver's own turn fills the run limit before the workers are considered.
  h.ctx.config.defaults.maxConcurrentRuns = 1;
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
}

/** A turn that holds the slot until the test releases it. */
function queueStuckTurn(): void {
  let resolve!: (value: Partial<TurnResult>) => void;
  const held = new Promise<Partial<TurnResult>>((r) => { resolve = r; });
  release = () => resolve(IDLE);
  runtime.queue.push(() => held);
}

function releaseTurn(): void {
  release?.();
  release = undefined;
}

afterEach(async () => {
  releaseTurn();
  await dispatcher?.stop();
  h?.cleanup();
});

const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;
const succeededRunsFor = (agentId: string): number =>
  h.db.all<Run>("SELECT id FROM runs WHERE agent_id = ? AND status = 'succeeded'", [agentId]).length;

describe('a merge slot holder takes the next free run slot (VS-464)', () => {
  it('dispatches the admitted merge, not the never-run worker, when the slot frees', async () => {
    setup();
    const ordinary = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const ordinaryWake = h.services.wake!.enqueue(ordinary, { source: 'ticket_assigned', reason: 'first run' });
    const merger = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const mergeWake = h.services.wake!.enqueue(merger, { source: 'merge_approved', reason: 'VS-1 is at the front of the merge queue' });
    // The merge worker finished its PR turn recently, so the plain fairness order would put it last.
    h.db.run('UPDATE agents SET last_run_at = ? WHERE id = ?', [nowIso(), merger]);
    const weaverWake = h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'restart' });

    // The weaver takes the only slot first and holds it.
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(weaverWake.id)).not.toBe('queued');

    // Run limit full: neither worker may start yet.
    await dispatcher.tick();
    expect(wakeStatus(mergeWake.id)).toBe('queued');
    expect(wakeStatus(ordinaryWake.id)).toBe('queued');

    // A slot frees: the merge slot holder goes ahead of the never-run worker.
    runtime.queue.push(IDLE, IDLE);
    releaseTurn();
    await dispatcher.drain();

    await dispatcher.tick();
    await dispatcher.drain();
    expect(succeededRunsFor(merger)).toBe(1);
    expect(succeededRunsFor(ordinary)).toBe(0);
    expect(wakeStatus(mergeWake.id)).not.toBe('queued');
    expect(wakeStatus(ordinaryWake.id)).toBe('queued');
  });

  it('leaves the ordinary fairness order alone with no merge wake', async () => {
    setup();
    const neverRun = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const neverWake = h.services.wake!.enqueue(neverRun, { source: 'ticket_assigned', reason: 'first run' });
    const ranRecently = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const ranWake = h.services.wake!.enqueue(ranRecently, { source: 'ticket_assigned', reason: 'more work' });
    h.db.run('UPDATE agents SET last_run_at = ? WHERE id = ?', [nowIso(), ranRecently]);
    h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'restart' });

    queueStuckTurn();
    await dispatcher.tick();
    runtime.queue.push(IDLE, IDLE);
    releaseTurn();
    await dispatcher.drain();

    await dispatcher.tick();
    await dispatcher.drain();
    expect(succeededRunsFor(neverRun)).toBe(1);
    expect(succeededRunsFor(ranRecently)).toBe(0);
    expect(wakeStatus(neverWake.id)).not.toBe('queued');
    expect(wakeStatus(ranWake.id)).toBe('queued');
  });
});
