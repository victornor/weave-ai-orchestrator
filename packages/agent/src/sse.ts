export interface SseEvent { event?: string; data: string }

/**
 * A byte-level Server-Sent-Events parser. It decodes with a streaming UTF-8 decoder, so a
 * multi-byte character split across reads survives, and accepts CRLF, LF and lone CR line
 * endings. A `\r` at the very end of a read is held back: the next read may begin with the `\n`
 * of a CRLF pair. Feeding the same bytes in any split yields the same events.
 */
export class SseParser {
  private decoder = new TextDecoder('utf-8');
  private buf = '';
  private data: string[] = [];
  private event: string | undefined;

  feed(bytes: Uint8Array): SseEvent[] {
    this.buf += this.decoder.decode(bytes, { stream: true });
    return this.drain(false);
  }

  /** Flush at end of input: a final unterminated line and a pending event are delivered rather than lost. */
  end(): SseEvent[] {
    this.buf += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): SseEvent[] {
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buf);
      if (!m) break;
      if (m[0] === '\r' && m.index === this.buf.length - 1 && !final) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      this.line(line, out);
    }
    if (final) {
      if (this.buf) { this.line(this.buf, out); this.buf = ''; }
      this.dispatch(out);
    }
    return out;
  }

  private line(line: string, out: SseEvent[]): void {
    if (line === '') { this.dispatch(out); return; }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
  }

  private dispatch(out: SseEvent[]): void {
    if (this.data.length > 0) out.push({ ...(this.event !== undefined ? { event: this.event } : {}), data: this.data.join('\n') });
    this.data = [];
    this.event = undefined;
  }
}
