import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { clock, liveTurn } from './liveTurn.js';

let seq = 0;
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const ev = (type: RunEvent['type'], payload: Record<string, unknown>, sec: number): RunEvent => ({ id: String(++seq), runId: 'r', seq, ts: new Date(T0 + sec * 1000).toISOString(), type, stream: 'runtime', level: 'info', payload });
const call = (id: string, sec: number, command = 'ls') => ev('tool.call', { id, name: 'bash', input: { command } }, sec);
const result = (id: string, sec: number) => ev('tool.result', { id, name: 'bash' }, sec);
const now = (sec: number) => T0 + sec * 1000;

describe('liveTurn (VS-595)', () => {
  it('says the turn is starting before anything has happened', () => {
    expect(liveTurn([], [], now(2), {})).toMatchObject({ state: 'starting', label: 'Starting the turn' });
  });

  it('reads "waiting for the model" with elapsed seconds between a finished tool and the next step', () => {
    const t = liveTurn([call('a', 1), result('a', 2)], [], now(6), { partialOutput: 'full' });
    expect(t).toMatchObject({ state: 'waiting', label: 'Waiting for the model', stateMs: 4000, sinceLastMs: 4000, turnMs: 5000, toolCount: 1, wholeStepsOnly: false });
  });

  it('shows a running tool with its command and elapsed time, and completes it in place', () => {
    const events = [call('a', 1, 'sleep 3; ls')];
    expect(liveTurn(events, [], now(4), { partialOutput: 'full' })).toMatchObject({ state: 'tool', label: 'Running bash sleep 3; ls', stateMs: 3000 });
    expect(liveTurn([...events, result('a', 4)], [], now(4), { partialOutput: 'full' }).state).toBe('waiting');
  });

  it('counts extra concurrent tools', () => {
    const t = liveTurn([call('a', 1), call('b', 2, 'pwd')], [], now(3), {});
    expect(t.label).toBe('Running bash pwd (+1 more)');
    expect(t.running).toHaveLength(2);
  });

  it('prefers streaming text, then thinking, over waiting', () => {
    const e = [call('a', 1), result('a', 2)];
    expect(liveTurn(e, [{ partId: 'p', kind: 'text', text: 'Hel' }], now(3), { partialOutput: 'full', partialSince: now(2.5), lastPartialAt: now(3) })).toMatchObject({ state: 'streaming', label: 'Writing', stateMs: 500, sinceLastMs: 0 });
    expect(liveTurn(e, [{ partId: 'p', kind: 'thinking', text: 'hm' }], now(3), { partialOutput: 'full' }).state).toBe('thinking');
  });

  it('a long tool-only turn: 50 calls, no text, still says what it is doing and how long it has been quiet', () => {
    const events: RunEvent[] = [];
    for (let i = 0; i < 50; i++) { events.push(call(`c${i}`, i * 6, `rg thing${i}`)); if (i < 49) events.push(result(`c${i}`, i * 6 + 5)); }
    const t = liveTurn(events, [], now(49 * 6 + 2), { partialOutput: 'full' });
    expect(t).toMatchObject({ state: 'tool', toolCount: 50, label: 'Running bash rg thing49', turnMs: (49 * 6 + 2) * 1000, sinceLastMs: 2000 });
  });

  it('flags a runtime that cannot stream so the page can say so', () => {
    expect(liveTurn([call('a', 1), result('a', 2)], [], now(3), { partialOutput: 'none' }).wholeStepsOnly).toBe(true);
    expect(liveTurn([], [], now(3), {}).wholeStepsOnly).toBe(true);
  });

  it('formats the clock compactly', () => {
    expect(clock(4200)).toBe('4 s');
    expect(clock(65_000)).toBe('1 m 05 s');
  });
});
