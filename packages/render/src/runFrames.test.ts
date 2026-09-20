import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { runEventFromFrame } from './runFrames.js';

const event: RunEvent = { id: '1', runId: 'r', seq: 7, ts: '2026-09-19T12:00:00Z', type: 'assistant.text', stream: 'runtime', level: 'info', payload: { text: 'hi' } };

describe('runEventFromFrame (VS-603)', () => {
  it('reads a bare RunEvent, whose own payload must not be mistaken for the event', () => {
    expect(runEventFromFrame(event)).toBe(event);
  });

  it('still reads a frame that wraps the event', () => {
    expect(runEventFromFrame({ payload: event })).toBe(event);
  });

  it('returns null for a frame that is not a run event', () => {
    expect(runEventFromFrame(null)).toBeNull();
    expect(runEventFromFrame({ payload: { text: 'hi' } })).toBeNull();
    expect(runEventFromFrame({ type: 'run.delta', payload: { parts: [] } })).toBeNull();
  });
});
