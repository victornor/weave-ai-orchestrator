/**
 * The terminal live row (VS-603): the state wording a terminal surface shows, and that a
 * `run.delta` frame moves the row without a run event — the same rules the web row follows.
 */
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { applyDelta, fromSnapshot } from '@weave-ai/render';
import { activityLineFor } from './ActivityLine.js';

let seq = 0;
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const ev = (type: RunEvent['type'], payload: Record<string, unknown>, sec: number): RunEvent => ({ id: String(++seq), runId: 'r', seq, ts: new Date(T0 + sec * 1000).toISOString(), type, stream: 'runtime', level: 'info', payload });
const call = (id: string, sec: number, command = 'ls') => ev('tool.call', { id, name: 'bash', input: { command } }, sec);
const result = (id: string, sec: number) => ev('tool.result', { id, name: 'bash' }, sec);
const now = (sec: number) => T0 + sec * 1000;

describe('activityLineFor (VS-603)', () => {
  it('names each state for a terminal surface', () => {
    expect(activityLineFor([], [], now(2), 'claude')).toBe('Starting the turn · 0 s');
    expect(activityLineFor([call('a', 1, 'sleep 3; ls')], [], now(4), 'claude')).toBe('Running bash sleep 3; ls · 3 s');
    const done = [call('a', 1), result('a', 2)];
    expect(activityLineFor(done, [], now(6), 'claude')).toBe('Waiting for the model · 4 s · 1 tool call');
    expect(activityLineFor(done, [{ partId: 'p', kind: 'text', text: 'Hi' }], now(3), 'claude', { partialSince: now(2.5) })).toBe('Writing · 0 s · 1 tool call');
    expect(activityLineFor(done, [{ partId: 'p', kind: 'thinking', text: 'hm' }], now(3), 'claude')).toBe('Thinking · 1 s · 1 tool call');
  });

  it('says whole steps only for a runtime that cannot stream', () => {
    const done = [call('a', 1), result('a', 2)];
    expect(activityLineFor(done, [], now(3), 'some-runtime')).toBe('Waiting for the model · 1 s · 1 tool call · whole steps only');
  });

  it('a run.delta frame moves the row from waiting to writing without a new run event', () => {
    const events = [call('a', 1), result('a', 2)];
    let partials = fromSnapshot({ partials: [] });
    expect(activityLineFor(events, [...partials.values()], now(6), 'claude')).toBe('Waiting for the model · 4 s · 1 tool call');
    partials = applyDelta(partials, [{ partId: 'p', kind: 'text', offset: 0, text: 'Let me ' }]).map;
    expect(activityLineFor(events, [...partials.values()], now(6), 'claude', { partialSince: now(6), lastPartialAt: now(6) })).toBe('Writing · 0 s · 1 tool call');
  });

  it('reconnect recovers the partial from the live snapshot', () => {
    const events = [call('a', 1), result('a', 2)];
    const seeded = fromSnapshot({ partials: [{ partId: 'p', kind: 'text', text: 'so far' }] });
    expect(activityLineFor(events, [...seeded.values()], now(6), 'claude', { partialSince: now(6), lastPartialAt: now(6) })).toBe('Writing · 0 s · 1 tool call');
  });
});
