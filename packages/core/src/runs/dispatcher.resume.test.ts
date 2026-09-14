/**
 * VS-375: a daemon restart leaves the turns it cut off with their wakes `queued` (VS-339), but the
 * dispatcher's plain fairness order started never-run workers first — the cut-off worker already has a
 * non-null `last_run_at`. These tests pin the new order: the weaver first, then a worker whose latest
 * run ended `interrupted_by_shutdown`, then the ordinary `last_run_at` fairness order.
 */
import { newId, nowIso } from '@weave-ai/db';
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

/** A worker whose latest run the previous shutdown recorded `interrupted_by_shutdown`, wake still queued. */
function interruptedWorker(errorCode: 'interrupted_by_shutdown' | 'interrupted'): { id: string; wakeId: string } {
  const id = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
  const wake = h.services.wake!.enqueue(id, { source: 'retry', reason: 'previous turn was interrupted' });
  const at = nowIso();
  h.db.run('UPDATE agents SET last_run_at = ? WHERE id = ?', [at, id]);
  h.db.run(
    `INSERT INTO runs (id, workspace_id, agent_id, wakeup_ids_json, runtime_id, status, turn_epoch, cwd, error_code, error_family, finished_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId(), h.workspaceId, id, JSON.stringify([wake.id]), 'fake', 'interrupted', 1, '/tmp/w', errorCode, 'tooling', at, at],
  );
  return { id, wakeId: wake.id };
}

describe('a restart resumes its cut-off turns before brand-new workers (VS-375)', () => {
  it('dispatches the shutdown-interrupted worker, not the never-run one, when the slot frees', async () => {
    setup();
    const interrupted = interruptedWorker('interrupted_by_shutdown');
    const neverRun = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const neverWake = h.services.wake!.enqueue(neverRun, { source: 'ticket_assigned', reason: 'first run' });
    const weaverWake = h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'restart' });

    // The weaver takes the only slot first and holds it.
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(weaverWake.id)).not.toBe('queued');

    // Run limit full: neither worker may start yet.
    await dispatcher.tick();
    expect(wakeStatus(interrupted.wakeId)).toBe('queued');
    expect(wakeStatus(neverWake.id)).toBe('queued');

    // A slot frees: the interrupted worker goes ahead of the never-run one.
    runtime.queue.push(IDLE, IDLE);
    releaseTurn();
    await dispatcher.drain();

    await dispatcher.tick();
    await dispatcher.drain();
    expect(succeededRunsFor(interrupted.id)).toBe(1);
    expect(succeededRunsFor(neverRun)).toBe(0);
    expect(wakeStatus(interrupted.wakeId)).not.toBe('queued');
    expect(wakeStatus(neverWake.id)).toBe('queued');
  });

  it('leaves the ordinary fairness order alone for a run that was not a shutdown cut', async () => {
    setup();
    const neverRun = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const neverWake = h.services.wake!.enqueue(neverRun, { source: 'ticket_assigned', reason: 'first run' });
    // A human interrupt, not a shutdown cut: it ran before but must not outrank a never-run worker.
    const cancelled = interruptedWorker('interrupted');

    queueStuckTurn();
    runtime.queue.push(IDLE);
    await dispatcher.tick();

    expect(wakeStatus(neverWake.id)).not.toBe('queued');
    expect(wakeStatus(cancelled.wakeId)).toBe('queued');
    releaseTurn();
    await dispatcher.drain();
  });
});
