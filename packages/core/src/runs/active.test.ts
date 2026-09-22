import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import type { RunEvent } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { describeLiveInput, emitRunEvent, runState } from './active.js';

describe('emitRunEvent (VS-417)', () => {
  let h: TestHarness;

  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  it('broadcasts each run event as a live-only workspace frame carrying the RunEvent', async () => {
    const ev: RunEvent = {
      id: '1', runId: 'run-1', seq: 1, ts: '2026-09-14T00:00:00.000Z', type: 'assistant.text',
      stream: 'stdout', level: 'info', payload: { text: 'Deploying the fix.' },
    };
    emitRunEvent(h.ctx, 'run-1', ev);
    await new Promise((r) => setTimeout(r, 0));

    const frame = h.events.find((e) => String(e.type) === 'run.event');
    expect(frame).toMatchObject({ seq: 0, entityType: 'run', entityId: 'run-1', payload: { runId: 'run-1', event: ev } });
  });

  it('writes no outbox row — the frame is recovered from the run read, not replay', async () => {
    emitRunEvent(h.ctx, 'run-1', {
      id: '1', runId: 'run-1', seq: 1, ts: '2026-09-14T00:00:00.000Z', type: 'assistant.text',
      stream: 'stdout', level: 'info', payload: {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM events')!.n).toBe(0);
  });
});


describe('describeLiveInput (VS-99)', () => {
  let h: TestHarness;
  let runtime: FakeRuntime;

  beforeEach(() => {
    h = makeHarness();
    runtime = new FakeRuntime();
    h.ctx.registries.runtimes.set('fake', runtime);
  });
  afterEach(() => h.cleanup());

  it('names the runtime as the reason when it does not support mid-turn input at all', () => {
    runtime.streamingInput = false;
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status.midTurn).toBe(false);
    expect(status.reason).toMatch(/does not support/);
  });

  it('says no turn is running when the runtime is capable but nothing is executing', () => {
    runtime.streamingInput = true;
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status.midTurn).toBe(false);
    expect(status.reason).toMatch(/no turn is currently running/);
  });

  it('reports mid-turn when the runtime is capable and a live run with a channel is active', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    expect(describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null })).toEqual({ midTurn: true });
  });

  it('does not report mid-turn for a different agent’s active run', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'someone-else', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status.midTurn).toBe(false);
  });

  it('does not report mid-turn for an active run with no send (the turn opened no channel)', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', { runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1, cancel: async () => undefined });
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status.midTurn).toBe(false);
  });

  it('reports `interrupts: true` when the runtime cannot take mid-turn input but a turn is running (VS-254)', () => {
    runtime.streamingInput = false;
    runState(h.ctx).active.set('run-1', { runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1, cancel: async () => undefined });
    expect(describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null })).toEqual({ midTurn: false, interrupts: true });
  });

  it('does not report `interrupts` for a different agent’s running turn on a non-streaming runtime (VS-254)', () => {
    runtime.streamingInput = false;
    runState(h.ctx).active.set('run-1', { runId: 'run-1', agentId: 'someone-else', startedAt: Date.now(), pid: 1, cancel: async () => undefined });
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status.interrupts).toBeUndefined();
    expect(status.reason).toMatch(/does not support/);
  });

  it('keeps the plain "does not support" reason for a non-streaming runtime with no turn running (VS-254)', () => {
    runtime.streamingInput = false;
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'worker', ticketId: null });
    expect(status).toEqual({ midTurn: false, reason: expect.stringMatching(/does not support/) });
  });

  it('reports `interrupts` for a ticketless session on a streaming runtime with a turn running (VS-657)', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    expect(describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'session', ticketId: null }))
      .toEqual({ midTurn: false, interrupts: true });
  });

  it('says no turn is running for a ticketless session with nothing executing (VS-657)', () => {
    runtime.streamingInput = true;
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'session', ticketId: null });
    expect(status).toEqual({ midTurn: false, reason: expect.stringMatching(/no turn is currently running/) });
  });

  it('keeps mid-turn delivery for a session that holds a ticket (VS-657)', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    expect(describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake', kind: 'session', ticketId: 'ticket-1' }))
      .toEqual({ midTurn: true });
  });
});
