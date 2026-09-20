import { describe, expect, it } from 'vitest';
import { SseParser } from './sse.js';

const enc = new TextEncoder();
function parse(text: string, split?: number): Array<{ event?: string; data: string }> {
  const p = new SseParser(); const b = enc.encode(text);
  const out = split === undefined ? p.feed(b) : [...p.feed(b.slice(0, split)), ...p.feed(b.slice(split))];
  return [...out, ...p.end()];
}

describe('SseParser', () => {
  it('accepts data with and without a space, comments, and multi-line data', () => {
    expect(parse(': hi\n\ndata:a\n\ndata: b\ndata: c\n\n')).toEqual([{ data: 'a' }, { data: 'b\nc' }]);
  });
  it('accepts CRLF, CR and LF endings, also when a CRLF pair is split across reads', () => {
    const text = 'data: 1\r\n\r\ndata: 2\r\rdata: 3\n\n';
    const want = [{ data: '1' }, { data: '2' }, { data: '3' }];
    expect(parse(text)).toEqual(want);
    for (let i = 0; i <= text.length; i++) expect(parse(text, i)).toEqual(want);
  });
  it('keeps a multi-byte character split across reads', () => {
    const text = 'data: 日本語 — é\n\n';
    const bytes = enc.encode(text);
    for (let i = 0; i <= bytes.length; i++) expect(parse(text, i)).toEqual([{ data: '日本語 — é' }]);
  });
  it('delivers a final unterminated event at end of input', () => {
    expect(parse('data: tail')).toEqual([{ data: 'tail' }]);
  });
  it('carries the event field', () => {
    expect(parse('event: ping\ndata: {}\n\n')).toEqual([{ event: 'ping', data: '{}' }]);
  });
});
