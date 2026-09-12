/**
 * VS-249: a worker whose session is held by a human must not be dispatched a turn — the collision
 * the whole handover design exists to prevent. This already falls out of the dispatcher's existing
 * `paused` exclusion (`IDLE_AGENT_STATUSES`); this test makes that exclusion explicit for a
 * `startHandover`-held worker rather than relying on it by accident (`session-handover/lease`).
 */
import { newId, nowIso } from '@agent-conductor/db';
import { FakeRuntime } from '@agent-conductor/runtime-sdk';
import type { Run, Wakeup } from '@agent-conductor/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWakeService } from '../wake/index.js';
import { createRunsService } from './index.js';
import { createDispatcher, type CoreDispatcher } from './dispatcher.js';
import { createWorkersService } from '../workers/index.js';
import { createSupervisor } from '../supervisor/index.js';

const idle = { structured: { state: 'idle', summary: 'nothing to do', tickets: [], knowledge: { recorded: false, reason: 'test fixture' } } };

let h: TestHarness;
let runtime: FakeRuntime;
let dispatcher: CoreDispatcher;

function setup(): void {
  h = makeHarness();
  runtime = new FakeRuntime();
  h.ctx.registries.runtimes.set('fake', runtime);
  h.ctx.config.models = { weaver: { runtime: 'fake', model: null }, workers: { runtime: 'fake', model: null }, workerOptions: [] };
  h.services.wake = createWakeService(h.ctx, h.deps);
  h.services.runs = createRunsService(h.ctx, h.deps);
  h.services.tickets = { comment: () => ({ id: 'c1' }) } as never;
  dispatcher = createDispatcher(h.ctx, h.deps);
  h.services.dispatcher = dispatcher;
  runtime.queue.push(idle);
}

afterEach(async () => { await dispatcher.stop(); h.cleanup(); });

const runCountFor = (agentId: string): number => h.db.all<Run>('SELECT id FROM runs WHERE agent_id = ?', [agentId]).length;
const wakeStatus = (id: string): string => h.db.get<Wakeup>('SELECT * FROM wakeups WHERE id = ?', [id])!.status;

describe('dispatcher does not claim a worker whose session is held by a human (VS-249)', () => {
  it('leaves a wake queued for a handed-over worker, and claims it once given back', async () => {
    setup();
    const workerId = h.addWorker(null, { runtimeId: 'fake', worktreePath: null });
    h.db.insert('agent_sessions', {
      id: newId(), agentId: workerId, runtimeId: 'fake', sessionRefJson: { sessionId: 'sess-1' }, displayId: null,
      status: 'active', turnCount: 1, cumulativeUsageJson: {}, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const workers = createWorkersService(h.ctx, h.deps);
    const started = await workers.startHandover({ kind: 'human', id: 'victor' }, workerId);
    expect(started.resumable).toBe(true);
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('paused');

    // A wake sent while the agent is `paused` is skipped at enqueue time, before the dispatcher's
    // own candidate query even runs — so a held worker's held-ness is enforced at two layers.
    const w = h.services.wake!.enqueue(workerId, { source: 'conductor_request', reason: 'are you still there' });
    expect(wakeStatus(w.id)).toBe('skipped');

    await dispatcher.tick();
    await dispatcher.drain();
    expect(runCountFor(workerId)).toBe(0);

    await workers.endHandover({ kind: 'human', id: 'victor' }, workerId, 'nothing needed doing after all');
    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(1);
  });

  it('a worker with an abandoned, now-closed hold is dispatchable again with no manual data changes', async () => {
    setup();
    const workerId = h.addWorker(null, { runtimeId: 'fake', worktreePath: null, status: 'paused' });
    const started = new Date(Date.now() - 200 * 60_000).toISOString();
    h.db.insert('agent_handovers', {
      id: newId(), agentId: workerId, ticketId: null, runtimeId: 'fake', sessionRefJson: { sessionId: 'sess-1' },
      worktreeHead: null, worktreeBranch: null, startedAt: started, startedBy: 'victor', status: 'active',
      lastActivitySignal: null, lastActivityAt: started, createdAt: started, updatedAt: started,
    });
    h.services.tickets = { livenessViolations: () => [], comment: () => ({ id: 'c1' }) } as never;
    h.services.workers = { spawnForTicket: vi.fn(), retireIfLanded: vi.fn(), conductor: () => ({ id: h.conductorId }), cancel: vi.fn() } as never;
    h.services.decisions = { expireDue: vi.fn(async () => []) } as never;
    h.services.projects = { fetch: vi.fn(async () => ({ head: 'abc', fastForwarded: false })) } as never;
    h.services.accounts = { list: () => [], get: () => null, refresh: vi.fn(async () => []) } as never;
    const supervisor = createSupervisor(h.ctx, h.deps);

    await supervisor.tick();
    supervisor.stop();

    expect(h.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [workerId])!.status).toBe('active');
    expect(h.db.get<{ status: string }>('SELECT status FROM agent_handovers WHERE agent_id = ?', [workerId])!.status).toBe('abandoned');

    await dispatcher.tick();
    await dispatcher.drain();

    expect(runCountFor(workerId)).toBe(1);
  });
});
