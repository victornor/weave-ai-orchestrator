/** `weave runs tail`'s live line (VS-603): each state, formatted exactly as the web row does. */
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { liveTurnLine } from '@weave-ai/render';
import { runsTailTurn } from './runs.js';

let seq = 0;
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const ev = (type: RunEvent['type'], payload: Record<string, unknown>, sec: number): RunEvent => ({ id: String(++seq), runId: 'r', seq, ts: new Date(T0 + sec * 1000).toISOString(), type, stream: 'runtime', level: 'info', payload });
const call = (id: string, sec: number, command = 'ls') => ev('tool.call', { id, name: 'bash', input: { command } }, sec);
const result = (id: string, sec: number) => ev('tool.result', { id, name: 'bash' }, sec);
const now = (sec: number) => T0 + sec * 1000;

describe('runsTailTurn (VS-603)', () => {
  it('formats each state for the follow output', () => {
    expect(liveTurnLine(runsTailTurn([], [], now(2), 'full'))).toBe('Starting the turn · 0 s');
    expect(liveTurnLine(runsTailTurn([call('a', 1, 'sleep 3; ls')], [], now(4), 'full'))).toBe('Running bash sleep 3; ls · 3 s');
    const done = [call('a', 1), result('a', 2)];
    expect(liveTurnLine(runsTailTurn(done, [], now(6), 'full'))).toBe('Working · 4 s · 1 tool call');
    expect(liveTurnLine(runsTailTurn(done, [{ partId: 'p', kind: 'text', text: 'Hi' }], now(3), 'full'))).toBe('Writing · 1 s · 1 tool call');
  });

  it('flags a runtime that reports whole steps only', () => {
    const done = [call('a', 1), result('a', 2)];
    expect(liveTurnLine(runsTailTurn(done, [], now(3), 'none'))).toBe('Working · 1 s · 1 tool call · whole steps only');
  });

  it('produces the same label for repeated frames of one state, so tail does not reprint', () => {
    const done = [call('a', 1), result('a', 2)];
    const first = runsTailTurn(done, [{ partId: 'p', kind: 'text', text: 'Hel' }], now(3), 'full').label;
    const second = runsTailTurn(done, [{ partId: 'p', kind: 'text', text: 'Hello' }], now(3.4), 'full').label;
    expect(second).toBe(first);
  });
});
