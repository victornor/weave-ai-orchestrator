/**
 * VS-262: `Dispatcher.stop(timeoutMs)`'s bounded form — the primitive `shutdown()`'s two-stage
 * drain-then-cancel sequence (packages/server/src/daemon.ts) and `POST /api/daemon/drain` both build
 * on. With no argument it keeps today's unbounded wait; with one, it races the drain against a timer
 * and reports whether the drain actually finished.
 */
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;
let resolveTurn: (() => void) | undefined;

function setup(): void {
  h = makeHarness();
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
}

/** A turn that never finishes on its own, only when the test calls the returned resolver. */
function queueStuckTurn(): void {
  runtime.queue.push(() => new Promise((resolve) => { resolveTurn = () => resolve({}); }));
}

afterEach(async () => {
  resolveTurn?.();
  await dispatcher.drain();
  h.cleanup();
  resolveTurn = undefined;
});

describe('Dispatcher.stop(timeoutMs) (VS-262)', () => {
  it('with no argument, keeps the unbounded wait and returns true once drained', async () => {
    setup();
    await expect(dispatcher.stop()).resolves.toBe(true);
  });

  it('with a timeout and nothing in flight, returns true immediately', async () => {
    setup();
    await expect(dispatcher.stop(50)).resolves.toBe(true);
  });

  it('returns false once the timeout elapses with a turn still running, without waiting for it to finish', async () => {
    setup();
    queueStuckTurn();
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    await dispatcher.tick();
    expect(dispatcher.running()).toBe(1);

    const started = Date.now();
    await expect(dispatcher.stop(50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    // The turn is still running — stop(timeoutMs) reports the timeout, it does not cancel anything itself.
    expect(dispatcher.running()).toBe(1);
  });

  it('calling stop() twice in a row is safe', async () => {
    setup();
    queueStuckTurn();
    h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'go' });
    await dispatcher.tick();

    await expect(dispatcher.stop(30)).resolves.toBe(false);
    await expect(dispatcher.stop(30)).resolves.toBe(false);
  });
});
