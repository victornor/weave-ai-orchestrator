import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRuntime } from '@agent-conductor/runtime-sdk';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { describeLiveInput, runState } from './active.js';

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
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake' });
    expect(status.midTurn).toBe(false);
    expect(status.reason).toMatch(/does not support/);
  });

  it('says no turn is running when the runtime is capable but nothing is executing', () => {
    runtime.streamingInput = true;
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake' });
    expect(status.midTurn).toBe(false);
    expect(status.reason).toMatch(/no turn is currently running/);
  });

  it('reports mid-turn when the runtime is capable and a live run with a channel is active', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    expect(describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake' })).toEqual({ midTurn: true });
  });

  it('does not report mid-turn for a different agent’s active run', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', {
      runId: 'run-1', agentId: 'someone-else', startedAt: Date.now(), pid: 1,
      cancel: async () => undefined, send: async () => 'delivered',
    });
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake' });
    expect(status.midTurn).toBe(false);
  });

  it('does not report mid-turn for an active run with no send (the turn opened no channel)', () => {
    runtime.streamingInput = true;
    runState(h.ctx).active.set('run-1', { runId: 'run-1', agentId: 'agent-1', startedAt: Date.now(), pid: 1, cancel: async () => undefined });
    const status = describeLiveInput(h.ctx, { id: 'agent-1', runtimeId: 'fake' });
    expect(status.midTurn).toBe(false);
  });
});
