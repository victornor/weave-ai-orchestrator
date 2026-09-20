import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { clock, liveActivityLine, liveTurn, liveTurnLine, progressLine } from './liveTurn.js';

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

describe('liveTurnLine (VS-602)', () => {
  it('names the state and its elapsed seconds, with the tool count for a non-tool state', () => {
    const t = liveTurn([call('a', 1), result('a', 2)], [], now(6), { partialOutput: 'full' });
    expect(liveTurnLine(t)).toBe('Waiting for the model · 4 s · 1 tool call');
  });

  it('shows a running tool with its command and elapsed time', () => {
    const t = liveTurn([call('a', 1, 'sleep 3; ls')], [], now(4), { partialOutput: 'full' });
    expect(liveTurnLine(t)).toBe('Running bash sleep 3; ls · 3 s');
  });

  it('shows streaming text and thinking', () => {
    const e = [call('a', 1), result('a', 2)];
    expect(liveTurnLine(liveTurn(e, [{ partId: 'p', kind: 'text', text: 'Hi' }], now(3), { partialOutput: 'full', partialSince: now(2.5) }))).toBe('Writing · 0 s · 1 tool call');
    expect(liveTurnLine(liveTurn(e, [{ partId: 'p', kind: 'thinking', text: 'hm' }], now(3), { partialOutput: 'full' }))).toBe('Thinking · 1 s · 1 tool call');
  });

  it('says the turn is starting, and flags a runtime that reports whole steps only', () => {
    expect(liveTurnLine(liveTurn([], [], now(2), {}))).toBe('Starting the turn · 0 s · whole steps only');
  });
});

describe('liveActivityLine (VS-603)', () => {
  it('formats each state for a terminal surface from the events and partials', () => {
    expect(liveActivityLine([], [], now(2), {})).toBe('Starting the turn · 0 s · whole steps only');
    expect(liveActivityLine([call('a', 1, 'sleep 3; ls')], [], now(4), { partialOutput: 'full' })).toBe('Running bash sleep 3; ls · 3 s');
    const done = [call('a', 1), result('a', 2)];
    expect(liveActivityLine(done, [], now(6), { partialOutput: 'full' })).toBe('Waiting for the model · 4 s · 1 tool call');
    expect(liveActivityLine(done, [{ partId: 'p', kind: 'text', text: 'Hi' }], now(3), { partialOutput: 'full', partialSince: now(2.5) })).toBe('Writing · 0 s · 1 tool call');
    expect(liveActivityLine(done, [{ partId: 'p', kind: 'thinking', text: 'hm' }], now(3), { partialOutput: 'full' })).toBe('Thinking · 1 s · 1 tool call');
    expect(liveActivityLine(done, [], now(3), { partialOutput: 'none' })).toBe('Waiting for the model · 1 s · 1 tool call · whole steps only');
  });
});

describe('progressLine (VS-604)', () => {
  it('states a running tool generically, never the command or its target', () => {
    const t = liveTurn([call('a', 1, 'sleep 3; ls')], [], now(4), { partialOutput: 'full' });
    const line = progressLine(t);
    expect(line).toBe('Working · 3 s · 1 tool call');
    expect(line).not.toContain('bash');
    expect(line).not.toContain('sleep');
    expect(line).not.toContain('ls');
  });

  it('states the model wait, the writing and the thinking states with their seconds', () => {
    const e = [call('a', 1), result('a', 2)];
    expect(progressLine(liveTurn(e, [], now(6), { partialOutput: 'full' }))).toBe('Waiting for the model · 4 s · 1 tool call');
    expect(progressLine(liveTurn(e, [{ partId: 'p', kind: 'text', text: 'Hi' }], now(3), { partialOutput: 'full', partialSince: now(2.5) }))).toBe('Writing · 0 s · 1 tool call');
    expect(progressLine(liveTurn(e, [{ partId: 'p', kind: 'thinking', text: 'hm' }], now(3), { partialOutput: 'full' }))).toBe('Thinking · 1 s · 1 tool call');
  });

  it('states the turn start and the whole-steps-only notice, and omits a zero tool count', () => {
    expect(progressLine(liveTurn([], [], now(2), {}))).toBe('Starting the turn · 0 s · whole steps only');
    expect(progressLine(liveTurn([], [], now(2), { partialOutput: 'full' }))).toBe('Starting the turn · 0 s');
  });
});
