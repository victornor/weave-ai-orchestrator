import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { applyDelta } from '@weave-ai/render';
import { activityLineFor } from '../components/ActivityLine.js';
import { deliveryNotice, foldDelta, preSendLabel } from './Attach.js';

describe('deliveryNotice (VS-99)', () => {
  it('reports mid-turn delivery only when the server said so', () => {
    expect(deliveryNotice({ delivery: 'mid_turn' })).toBe('delivered to the running turn');
  });

  it('reports queued for the queued outcome', () => {
    expect(deliveryNotice({ delivery: 'queued' })).toBe('queued for the next turn');
  });

  it('never invents "delivered" for a missing or unrecognised outcome', () => {
    expect(deliveryNotice(null)).toBe('queued for the next turn');
    expect(deliveryNotice(undefined)).toBe('queued for the next turn');
    expect(deliveryNotice({})).toBe('queued for the next turn');
  });
});

describe('preSendLabel (VS-253)', () => {
  it('says the words reach the running turn when the API says so', () => {
    expect(preSendLabel({ midTurn: true })).toBe('Reaches the running turn immediately.');
  });

  it('says queued and carries the reason the API supplied', () => {
    expect(preSendLabel({ midTurn: false, reason: 'Codex does not support delivering input to a turn that is already running' }))
      .toBe('Queued for the next turn — Codex does not support delivering input to a turn that is already running.');
  });

  it('says queued without inventing a reason', () => {
    expect(preSendLabel({ midTurn: false })).toBe('Queued for the next turn.');
  });

  it('shows no label before the status is known', () => {
    expect(preSendLabel(null)).toBeNull();
    expect(preSendLabel(undefined)).toBeNull();
  });
});

describe('foldDelta (VS-603)', () => {
  const T0 = Date.parse('2026-09-19T12:00:00.000Z');
  const call = (id: string, sec: number): RunEvent => ({ id, runId: 'run-1', seq: sec, ts: new Date(T0 + sec * 1000).toISOString(), type: 'tool.call', stream: 'runtime', level: 'info', payload: { id, name: 'bash', input: { command: 'ls' } } });
  const result = (id: string, sec: number): RunEvent => ({ id, runId: 'run-1', seq: sec + 100, ts: new Date(T0 + sec * 1000).toISOString(), type: 'tool.result', stream: 'runtime', level: 'info', payload: { id, name: 'bash' } });
  const frame = (runId: string, offset: number, text: string) => ({ runId, parts: [{ partId: 'p', kind: 'text' as const, offset, text }] });

  it('applies a frame for the followed run and moves the row from waiting to writing', () => {
    const events = [call('a', 1), result('a', 2)];
    const next = foldDelta(new Map(), frame('run-1', 0, 'Let me '), 'run-1');
    expect(next.matched).toBe(true);
    expect(activityLineFor(events, [...next.map.values()], T0 + 6000, 'full', { partialSince: T0 + 6000, lastPartialAt: T0 + 6000 })).toBe('Writing · 0 s · 1 tool call');
  });

  it('ignores a frame for another run', () => {
    const held = applyDelta(new Map(), [{ partId: 'p', kind: 'text', offset: 0, text: 'keep' }]).map;
    const next = foldDelta(held, frame('run-2', 4, 'other'), 'run-1');
    expect(next.matched).toBe(false);
    expect(next.map).toBe(held);
  });

  it('reports a gap when a frame skips ahead', () => {
    const next = foldDelta(new Map(), frame('run-1', 5, 'late'), 'run-1');
    expect(next.matched).toBe(true);
    expect(next.gap).toBe(true);
    expect(next.map.size).toBe(0);
  });
});
