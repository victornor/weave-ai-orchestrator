/**
 * VS-495: a persistent role session (`kind='session'`) must never consume or be gated by the
 * project's transient-worker cap (`project.maxWorkers`), including while its turn runs concurrently
 * with a transient worker's turn. Before this change, `projectRunning()` counted every running agent
 * in the project regardless of kind, and the dispatcher's project-cap gate applied to every agent
 * with a `projectId` — so a session agent sharing a project with a maxed-out role would be silently
 * throttled exactly like a worker.
 */
import { FakeRuntime, type TurnResult } from '@weave-ai/runtime-sdk';
import type { Wakeup } from '@weave-ai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

const IDLE = { structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } };

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;
const releases: Array<() => void> = [];

function setup(maxWorkers: number): void {
  h = makeHarness();
  h.db.run('UPDATE projects SET max_workers = ? WHERE id = ?', [maxWorkers, h.projectId]);
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  h.ctx.config.defaults.maxConcurrentRuns = 6;
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
}

/** A turn that holds the slot until the test releases it. */
function queueStuckTurn(): void {
  let resolve!: (value: Partial<TurnResult>) => void;
  const held = new Promise<Partial<TurnResult>>((r) => { resolve = r; });
  releases.push(() => resolve(IDLE));
  runtime.queue.push(() => held);
}

function releaseAll(): void {
  while (releases.length) releases.pop()!();
}

afterEach(async () => {
  releaseAll();
  await dispatcher?.stop();
  h?.cleanup();
});

const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;

describe('a persistent session never consumes the project worker cap (VS-495)', () => {
  it('runs a session turn alongside a worker turn that already fills the project cap', async () => {
    setup(1);
    const worker = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const session = h.addWorker(null, { kind: 'session', runtimeId: 'fake', worktreePath: null, ticketId: null });

    const workerWake = h.services.wake!.enqueue(worker, { source: 'ticket_assigned', reason: 'first run' });
    const sessionWake = h.services.wake!.enqueue(session, { source: 'human_message', reason: 'chat' });

    // The worker's turn fills the project's single maxWorkers slot and holds it.
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(workerWake.id)).not.toBe('queued');

    // The session's turn is still admitted even though the project is at its worker cap.
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(sessionWake.id)).not.toBe('queued');

    releaseAll();
    await dispatcher.drain();
  });

  it('does not let a session turn delay a ticket worker turn under a full run queue', async () => {
    setup(1);
    const worker = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    const session = h.addWorker(null, { kind: 'session', runtimeId: 'fake', worktreePath: null, ticketId: null });

    const sessionWake = h.services.wake!.enqueue(session, { source: 'human_message', reason: 'chat' });

    // The session takes its own turn first; the project's worker cap must not have counted it.
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(sessionWake.id)).not.toBe('queued');

    const workerWake = h.services.wake!.enqueue(worker, { source: 'ticket_assigned', reason: 'first run' });
    queueStuckTurn();
    await dispatcher.tick();
    expect(wakeStatus(workerWake.id)).not.toBe('queued');

    releaseAll();
    await dispatcher.drain();
  });
});
