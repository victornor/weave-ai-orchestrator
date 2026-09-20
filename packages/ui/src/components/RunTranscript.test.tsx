/** VS-595: a live run never renders an empty working state; the row names what the worker is doing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { RunEvent } from '@weave-ai/shared';
import { RunTranscript } from './RunTranscript';

// The daemon's runtime list is what says whether a runtime streams (VS-615); the page holds no table of ids.
const DECLARED: Record<string, 'text' | 'full'> = { opencode: 'full', cursor: 'text', gemini: 'text' };
vi.mock('../api/hooks', () => ({ usePartialOutput: (runtimeId?: string | null) => (runtimeId ? DECLARED[runtimeId] ?? 'none' : 'none') }));

const T0 = Date.parse('2026-09-19T12:00:00.000Z');
let seq = 0;
const ev = (type: RunEvent['type'], payload: Record<string, unknown>, sec: number): RunEvent => ({ id: String(++seq), runId: 'r', seq, ts: new Date(T0 + sec * 1000).toISOString(), type, stream: 'runtime', level: 'info', payload });
const noStream = { partials: [], lastPartialAt: null, partialSince: null };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0 + 6000); });
afterEach(() => { vi.useRealTimers(); });

describe('RunTranscript live activity', () => {
  it('a live run with no events yet says it is starting, never a blank working state', () => {
    const { container } = render(<RunTranscript events={[]} live stream={noStream} runtimeId="opencode" label="t" />);
    const row = container.querySelector('[data-live-activity]')!;
    expect(row.getAttribute('data-live-state')).toBe('starting');
    expect(row.textContent).toContain('Starting the turn');
  });

  it('between steps it says it is waiting for the model, and the seconds tick on the page clock', () => {
    const events = [ev('tool.call', { id: 'a', name: 'bash', input: { command: 'ls' } }, 1), ev('tool.result', { id: 'a', name: 'bash' }, 2)];
    const { container } = render(<RunTranscript events={events} live stream={noStream} runtimeId="opencode" label="t" />);
    const row = () => container.querySelector('[data-live-activity]')!;
    expect(row().getAttribute('data-live-state')).toBe('waiting');
    expect(row().textContent).toContain('Waiting for the model');
    expect(row().textContent).toContain('4 s');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(row().textContent).toContain('7 s');
    expect(row().textContent).toContain('1 tool call');
    expect(row().querySelector('[data-live-whole-steps]')).toBeNull();
  });

  it('shows a running tool by its command, and streaming text as it is generated', () => {
    const events = [ev('tool.call', { id: 'a', name: 'bash', input: { command: 'sleep 3; ls' } }, 3)];
    const { container, rerender } = render(<RunTranscript events={events} live stream={noStream} runtimeId="opencode" label="t" />);
    expect(container.querySelector('[data-live-activity]')!.textContent).toContain('Running bash sleep 3; ls');
    const done = [...events, ev('tool.result', { id: 'a', name: 'bash' }, 5)];
    rerender(<RunTranscript events={done} live stream={{ partials: [{ partId: 'p', kind: 'text', text: 'Let me check' }], lastPartialAt: T0 + 6000, partialSince: T0 + 6000 }} runtimeId="opencode" label="t" />);
    expect(container.querySelector('[data-live-partials]')!.textContent).toContain('Let me check');
    expect(container.querySelector('[data-live-activity]')!.getAttribute('data-live-state')).toBe('streaming');
  });

  it('a runtime that cannot stream says so in words', () => {
    // A runtime whose capabilities declare no partial output.
    const { container } = render(<RunTranscript events={[]} live stream={noStream} runtimeId="unknown" label="t" />);
    expect(container.querySelector('[data-live-whole-steps]')!.textContent).toContain('whole steps only');
  });

  it.each(['cursor', 'gemini'])('%s streams text: the row reads as writing, not whole steps only (VS-600)', (runtimeId) => {
    const stream = { partials: [{ partId: 'p', kind: 'text' as const, text: 'Let me check' }], lastPartialAt: T0 + 6000, partialSince: T0 + 6000 };
    const { container } = render(<RunTranscript events={[]} live stream={stream} runtimeId={runtimeId} label="t" />);
    const row = container.querySelector('[data-live-activity]')!;
    expect(row.getAttribute('data-live-state')).toBe('streaming');
    expect(container.querySelector('[data-live-whole-steps]')).toBeNull();
    expect(container.querySelector('[data-live-partials]')!.textContent).toContain('Let me check');
  });

  it('coalesced streamed text renders as one block, not one per chunk (VS-600)', () => {
    const events = [ev('assistant.text', { text: 'Let me ' }, 1), ev('assistant.text', { text: 'check.' }, 2)];
    const { container } = render(<RunTranscript events={events} live stream={noStream} runtimeId="gemini" label="t" />);
    const blocks = container.querySelectorAll('.ac-prose');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.textContent).toBe('Let me check.');
  });

  it('a finished run renders no live row', () => {
    const { container } = render(<RunTranscript events={[ev('turn.completed', {}, 1)]} live={false} runtimeId="opencode" label="t" />);
    expect(container.querySelector('[data-live-activity]')).toBeNull();
  });
});
