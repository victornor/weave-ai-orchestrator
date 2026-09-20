import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { applyDelta, dropSuperseded, fromSnapshot } from './livePartials';

const part = (offset: number, text: string, partId = 'p1') => ({ partId, kind: 'text' as const, offset, text });
const done = (partId: string): RunEvent => ({ id: '1', runId: 'r', seq: 1, ts: '2026-09-19T00:00:00Z', type: 'assistant.text', stream: 'runtime', level: 'info', payload: { text: 'x', partId } });

describe('live partials (VS-595)', () => {
  it('appends frames in order', () => {
    let m = applyDelta(new Map(), [part(0, 'Let me ')]).map;
    m = applyDelta(m, [part(7, 'check')]).map;
    expect(m.get('p1')!.text).toBe('Let me check');
  });

  it('ignores a repeated frame and keeps only the new tail of an overlapping one', () => {
    let m = applyDelta(new Map(), [part(0, 'abcd')]).map;
    expect(applyDelta(m, [part(0, 'abcd')]).map.get('p1')!.text).toBe('abcd');
    m = applyDelta(m, [part(2, 'cdef')]).map;
    expect(m.get('p1')!.text).toBe('abcdef');
  });

  it('reports a gap instead of showing text with a hole', () => {
    const r = applyDelta(new Map(), [part(5, 'late')]);
    expect(r.gap).toBe(true);
    expect(r.map.size).toBe(0);
  });

  it('seeds from the snapshot a page reads when it connects mid-step', () => {
    const m = fromSnapshot({ partials: [{ partId: 'p1', kind: 'text', text: 'so far' }] });
    expect(applyDelta(m, [part(6, ' more')]).map.get('p1')!.text).toBe('so far more');
  });

  it('drops a part once its completed event is present, so it renders once', () => {
    const m = applyDelta(new Map(), [part(0, 'a'), part(0, 'b', 'p2')]).map;
    expect(dropSuperseded(m, [done('p1')]).map((p) => p.partId)).toEqual(['p2']);
  });
});
