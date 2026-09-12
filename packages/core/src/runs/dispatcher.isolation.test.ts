/**
 * An isolated daemon only dispatches a run a human explicitly asked for (VS-143,
 * daemon-isolation/dispatch-gate). A wake nobody asked for — a project add's `project_added`, an
 * automatic ticket assignment, a retry — must stay queued rather than spend a turn nobody requested;
 * a human-requested wake, sent directly (a chat message, answering a decision), must still work.
 *
 * The dispatcher only ever reads `ctx.isolated`; the opt-in that turns it false regardless of the
 * daemon's config directory (`--share-host-credentials`) is `resolveIsolation()`, pinned in
 * `packages/server/test/daemon.test.ts`.
 */
import { newId, nowIso } from '@agent-conductor/db';
import { FakeRuntime } from '@agent-conductor/runtime-sdk';
import type { Run, Wakeup } from '@agent-conductor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;

function setup(isolated: boolean): void {
  h = makeHarness({ isolated });
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
  runtime.queue.push({ structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } });
}

afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;
const runCountFor = (agentId: string): number => h.db.all<Run>('SELECT id FROM runs WHERE agent_id = ?', [agentId]).length;

describe('a non-isolated daemon is unaffected', () => {
  it('dispatches a system-requested wake exactly as it does today', async () => {
    setup(false);
    const w = h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'project added', requestedBy: { kind: 'system', id: null } });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(1);
    expect(wakeStatus(w.id)).not.toBe('queued');
  });
});

describe('an isolated daemon only dispatches what a human asked for', () => {
  it('leaves a system-requested wake queued and spawns no run', async () => {
    setup(true);
    const w = h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'project added', requestedBy: { kind: 'system', id: null } });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(0);
    expect(wakeStatus(w.id)).toBe('queued');
  });

  it('leaves an agent-requested wake queued and spawns no run', async () => {
    setup(true);
    const w = h.services.wake!.enqueue(h.conductorId, { source: 'ticket_assigned', reason: 'auto-assigned', requestedBy: { kind: 'agent', id: 'ag_other' } });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(0);
    expect(wakeStatus(w.id)).toBe('queued');
  });

  it('dispatches a wake a human sent directly', async () => {
    setup(true);
    const w = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hi', requestedBy: { kind: 'human', id: 'u1' } });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(1);
    expect(wakeStatus(w.id)).not.toBe('queued');
  });

  it('dispatches the whole bundle once a human-requested wake coalesces alongside a system one', async () => {
    setup(true);
    // The first wake queues; the second, for the same idle agent, coalesces into it (wake/index.ts Gate 3).
    const first = h.services.wake!.enqueue(h.conductorId, { source: 'system', reason: 'project added', requestedBy: { kind: 'system', id: null } });
    expect(wakeStatus(first.id)).toBe('queued');
    const second = h.services.wake!.enqueue(h.conductorId, { source: 'human_message', reason: 'hi', requestedBy: { kind: 'human', id: 'u1' } });
    expect(wakeStatus(second.id)).toBe('coalesced');

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(1);
    // The system-requested wake that coalesced into the human one was claimed and run alongside it.
    expect(wakeStatus(first.id)).not.toBe('queued');
  });

  it('adding a project does not dispatch the conductor about it (daemon-isolation/dispatch-gate)', async () => {
    setup(true);
    // Stand-in for describeTicket()'s wake to the conductor: no human asked for this.
    const w = h.services.wake!.enqueue(h.conductorId, {
      source: 'system', reason: 'a project was added', payload: { kind: 'project_added' }, requestedBy: { kind: 'system', id: null },
    });

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(h.conductorId)).toBe(0);
    expect(wakeStatus(w.id)).toBe('queued');
  });
});

