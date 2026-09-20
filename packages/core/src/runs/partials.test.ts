import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunDeltaFrame } from '@weave-ai/shared';
import { makeRedactor } from './engine.js';
import { PartialBuffer } from './partials.js';

const SECRET = 'sk-live-0123456789';
const setup = (secrets: string[] = [], capChars?: number) => {
  const frames: RunDeltaFrame[] = [];
  const r = makeRedactor(secrets);
  const buf = new PartialBuffer({ runId: 'r1', emit: (f) => frames.push(f), redact: (t) => r(t) as string, secrets: () => secrets, ...(capChars ? { capChars } : {}) });
  return { buf, frames };
};
const text = (frames: RunDeltaFrame[], partId = 'p1'): string => frames.flatMap((f) => f.parts).filter((p) => p.partId === partId).map((p) => p.text).join('');

describe('PartialBuffer (VS-595)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('coalesces 200 deltas in one second into at most 20 frames, in order, with offsets', () => {
    const { buf, frames } = setup();
    for (let i = 0; i < 200; i++) { buf.push({ kind: 'text', partId: 'p1', text: `${i},` }); vi.advanceTimersByTime(5); }
    vi.advanceTimersByTime(60);
    expect(frames.length).toBeLessThanOrEqual(21);
    expect(text(frames)).toBe(Array.from({ length: 200 }, (_, i) => `${i},`).join(''));
    let expected = 0;
    for (const f of frames) for (const p of f.parts) { expect(p.offset).toBe(expected); expected += p.text.length; }
  });

  it('masks a secret split across two deltas and never shows half of it', () => {
    const { buf, frames } = setup([SECRET]);
    buf.push({ kind: 'text', partId: 'p1', text: `token is ${SECRET.slice(0, 7)}` });
    vi.advanceTimersByTime(60);
    expect(text(frames)).not.toContain(SECRET.slice(0, 4));
    buf.push({ kind: 'text', partId: 'p1', text: `${SECRET.slice(7)} ok, and more text follows here` });
    vi.advanceTimersByTime(60);
    const shown = text(frames);
    expect(shown).toContain('[redacted]');
    expect(shown).not.toContain(SECRET.slice(0, 4));
    expect(shown).not.toContain(SECRET.slice(-4));
    expect(buf.snapshot().partials[0]!.text).toBe(shown);
  });

  it('masks a secret split across the deltas a cursor or gemini adapter reports (VS-600)', () => {
    for (const partId of ['cursor:msg:0', 'gemini:msg:0']) {
      const { buf, frames } = setup([SECRET]);
      buf.push({ kind: 'text', partId, text: SECRET.slice(0, 7) });
      vi.advanceTimersByTime(60);
      buf.push({ kind: 'text', partId, text: `${SECRET.slice(7)} tail` });
      vi.advanceTimersByTime(60);
      const shown = text(frames, partId);
      expect(shown).toContain('[redacted]');
      expect(shown).not.toContain(SECRET);
    }
  });

  it('drops a superseded part and keeps the snapshot to live parts', () => {
    const { buf } = setup();
    buf.push({ kind: 'thinking', partId: 'p1', text: 'hmm' });
    buf.push({ kind: 'text', partId: 'p2', text: 'hello' });
    vi.advanceTimersByTime(60);
    expect(buf.snapshot().partials.map((p) => p.partId).sort()).toEqual(['p1', 'p2']);
    buf.complete('p1');
    expect(buf.snapshot().partials.map((p) => p.partId)).toEqual(['p2']);
  });

  it('truncates a part at the cap without failing', () => {
    const { buf, frames } = setup([], 10);
    buf.push({ kind: 'text', partId: 'p1', text: '0123456789ABCDEF' });
    buf.push({ kind: 'text', partId: 'p1', text: 'more' });
    vi.advanceTimersByTime(60);
    expect(text(frames)).toBe('0123456789');
  });

  it('emits nothing after clear (cancel mid-stream, cut-off stream)', () => {
    const { buf, frames } = setup();
    buf.push({ kind: 'text', partId: 'p1', text: 'half a sent' });
    buf.clear();
    vi.advanceTimersByTime(200);
    expect(frames).toEqual([]);
    expect(buf.snapshot().partials).toEqual([]);
  });
  it('carries tool_output frames, masks a secret split across two chunks, and drops the part on completion (VS-615)', () => {
    const { buf, frames } = setup([SECRET]);
    buf.push({ kind: 'tool_output', partId: 'b1:out', toolCallId: 'b1', text: `building… key=${SECRET.slice(0, 9)}` });
    vi.advanceTimersByTime(60);
    expect(text(frames, 'b1:out')).not.toContain(SECRET.slice(0, 4));
    buf.push({ kind: 'tool_output', partId: 'b1:out', toolCallId: 'b1', text: `${SECRET.slice(9)}\nstill running, more output follows` });
    vi.advanceTimersByTime(60);
    const shown = text(frames, 'b1:out');
    expect(frames.flatMap((f) => f.parts).every((p) => p.kind === 'tool_output')).toBe(true);
    expect(shown).toContain('[redacted]');
    expect(shown).not.toContain(SECRET.slice(0, 4));
    expect(shown).not.toContain(SECRET.slice(-4));
    expect(buf.snapshot().partials).toEqual([{ partId: 'b1:out', kind: 'tool_output', text: shown }]);
    buf.complete('b1:out');
    expect(buf.snapshot().partials).toEqual([]);
  });
});
