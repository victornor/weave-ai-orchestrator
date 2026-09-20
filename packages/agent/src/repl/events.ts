import type { ChildPartial } from '../protocol.js';

export interface RenderOptions {
  color: boolean;
  /** Strings that must never reach the terminal (the provider key): each is replaced with `[redacted]`. */
  secrets?: readonly string[];
}
export interface RenderEvent { type: string; payload: Record<string, unknown> }

const ESC = '\x1b[';
const paint = (on: boolean, code: string, s: string): string => (on && s ? `${ESC}${code}m${s}${ESC}0m` : s);
const MAX_RESULT_LINES = 8;
const MAX_DIFF_LINES = 60;
const MAX_OUTPUT_TAIL = 15;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const oneLine = (s: string, max: number): string => { const first = s.split('\n')[0] ?? ''; return first.length > max ? `${first.slice(0, max - 1)}…` : first + (s.includes('\n') ? ' …' : ''); };

/** The one line a tool call is shown as: what it is about, not its whole argument object. */
export function summarizeCall(name: string, input: unknown): string {
  const i = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const path = str(i['path']) || str(i['file_path']);
  switch (name) {
    case 'bash': return oneLine(str(i['command']), 110);
    case 'read': case 'write': case 'edit': return path;
    case 'grep': return `${oneLine(str(i['pattern']), 60)}${path ? `  in ${path}` : ''}`;
    case 'glob': return `${oneLine(str(i['pattern']), 60)}${path ? `  in ${path}` : ''}`;
    case 'skill': return str(i['name']);
    case 'task': return oneLine(str(i['description']), 80);
    case 'web_fetch': return str(i['url']);
    case 'todo_write': return '';
    default: { const raw = typeof input === 'string' ? input : JSON.stringify(i); return oneLine(raw ?? '', 90); }
  }
}

/**
 * The terminal view of a turn. Feed it the loop's partials and events in order; each call returns the exact
 * text to write (ANSI when `color`). It holds only the small state streaming needs (which block is open,
 * which parts were already printed), so a golden test is a list of inputs and one expected string.
 */
export class Renderer {
  private open: { partId: string; kind: 'text' | 'thinking' | 'tool_output' } | null = null;
  private atLineStart = true;
  private streamed = new Set<string>();
  private shown = new Set<string>();
  constructor(private o: RenderOptions) {}

  private c(code: string, s: string): string { return paint(this.o.color, code, s); }
  private clean(s: string): string { let out = s; for (const k of this.o.secrets ?? []) if (k.length >= 4) out = out.split(k).join('[redacted]'); return out; }
  private out(s: string): string { const t = this.clean(s); if (t) this.atLineStart = t.endsWith('\n'); return t; }
  private lineStart(): string { return this.atLineStart ? '' : this.out('\n'); }
  private close(): string { if (!this.open) return ''; this.open = null; return this.lineStart(); }
  private indentLines(text: string, pad: string, style: (s: string) => string): string {
    return text.split('\n').map((l) => `${pad}${style(l)}`).join('\n');
  }

  /** A streamed fragment. Tool arguments are not shown as they stream; the call line appears once they are complete. */
  partial(p: ChildPartial): string {
    if (p.kind === 'tool_input' || !p.text) return '';
    let s = '';
    if (!this.open || this.open.partId !== p.partId) {
      s += this.close() + this.lineStart();
      this.open = { partId: p.partId, kind: p.kind };
      this.streamed.add(p.partId);
      if (p.kind === 'thinking') s += this.out(this.c('2', '∴ '));
    }
    if (p.kind === 'text') return s + this.out(p.text);
    const style = (t: string): string => this.c('2', t);
    if (p.kind === 'thinking') return s + this.out(style(p.text));
    // tool output: indented and dim, each line prefixed once at its start
    let atStart = this.atLineStart;
    let body = '';
    for (const [n, piece] of p.text.split('\n').entries()) {
      if (n > 0) { body += '\n'; atStart = true; }
      if (piece) { body += `${atStart ? '  ' : ''}${style(piece)}`; atStart = false; }
    }
    return s + this.out(body);
  }

  /** A completed event. */
  event(ev: RenderEvent): string {
    const p = ev.payload;
    const pad = p['parentId'] ? '    ' : '';
    switch (ev.type) {
      case 'assistant.text': {
        const streamed = this.streamed.has(str(p['partId']));
        if (streamed) return this.close();
        return this.close() + this.lineStart() + this.out(`${str(p['text'])}\n`);
      }
      case 'assistant.thinking': {
        if (this.streamed.has(str(p['partId']))) return this.close();
        return this.close() + this.lineStart() + this.out(`${this.c('2', `∴ ${oneLine(str(p['text']), 300)}`)}\n`);
      }
      case 'tool.call': {
        const name = str(p['name']);
        const summary = summarizeCall(name, p['input']);
        return this.close() + this.lineStart() + this.out(`${pad}${this.c('36', '▸')} ${this.c('1', name)}${summary ? `  ${this.c('2', summary)}` : ''}\n`);
      }
      case 'tool.denied': return this.close() + this.lineStart() + this.out(`${pad}  ${this.c('33', `denied: ${str(p['reason'])}`)}\n`);
      case 'file.changed': return this.fileChanged(p, pad);
      case 'command.executed': return this.commandExecuted(p, pad);
      case 'tool.result': return this.toolResult(p, pad);
      case 'plan.proposed': {
        const items = Array.isArray(p['items']) ? p['items'] as Array<Record<string, unknown>> : [];
        if (items.length === 0) return '';
        const mark = (s: unknown): string => (s === 'completed' ? '☑' : s === 'in_progress' ? '◐' : '☐');
        return this.close() + this.lineStart() + this.out(`${items.map((it) => `${pad}  ${mark(it['status'])} ${str(it['content'])}`).join('\n')}\n`);
      }
      case 'session.compaction.started': return this.close() + this.lineStart() + this.out(`${this.c('2', 'compacting the conversation…')}\n`);
      case 'session.compaction.completed': {
        const m = p['ok'] === true ? `compacted: ${String(p['tokensBefore'])} → ${String(p['tokensAfter'])} tokens` : 'nothing was compacted';
        return this.close() + this.lineStart() + this.out(`${this.c('2', m)}\n`);
      }
      case 'error': return this.close() + this.lineStart() + this.out(`${this.c('31', `error: ${str(p['message'])}`)}\n`);
      case 'turn.completed': return p['interrupted'] === true ? this.close() + this.lineStart() + this.out(`${this.c('2', 'interrupted')}\n`) : this.close();
      default: return '';
    }
  }

  /** The caller wrote a newline itself (steering echo): the next block starts on a fresh line. */
  resetLine(): void { this.open = null; this.atLineStart = true; }

  /** End of a turn: close any open block so the prompt starts on its own line. */
  finish(): string { return this.close() + this.lineStart(); }

  private fileChanged(p: Record<string, unknown>, pad: string): string {
    this.shown.add(str(p['id']));
    const path = str(p['path']);
    const head = `${pad}  ${this.c('2', `${str(p['changeType'])} ${path}`)} ${this.c('32', `+${String(p['additions'] ?? 0)}`)} ${this.c('31', `-${String(p['deletions'] ?? 0)}`)}\n`;
    const diff = str(p['diff']);
    if (!diff) return this.close() + this.lineStart() + this.out(head);
    const lines = diff.split('\n');
    const shown = lines.slice(0, MAX_DIFF_LINES).map((l) => {
      const style = l.startsWith('+') ? (s: string) => this.c('32', s) : l.startsWith('-') ? (s: string) => this.c('31', s) : l.startsWith('@@') ? (s: string) => this.c('36', s) : (s: string) => this.c('2', s);
      return `${pad}    ${style(l)}`;
    });
    if (lines.length > MAX_DIFF_LINES) shown.push(`${pad}    ${this.c('2', `… ${lines.length - MAX_DIFF_LINES} more lines`)}`);
    return this.close() + this.lineStart() + this.out(`${head}${shown.join('\n')}\n`);
  }

  private commandExecuted(p: Record<string, unknown>, pad: string): string {
    this.shown.add(str(p['id']));
    let s = this.close() + this.lineStart();
    const output = str(p['output']).replace(/\n+$/, '');
    if (output && !this.streamed.has(`${str(p['id'])}:out`)) {
      const lines = output.split('\n');
      const tail = lines.slice(-MAX_OUTPUT_TAIL);
      if (lines.length > tail.length) s += this.out(`${pad}  ${this.c('2', `… ${lines.length - tail.length} earlier lines`)}\n`);
      s += this.out(`${this.indentLines(tail.join('\n'), `${pad}  `, (l) => this.c('2', l))}\n`);
    }
    const code = p['exitCode'];
    if (code !== 0 && code !== undefined && code !== null) s += this.out(`${pad}  ${this.c('31', `exit ${String(code)}`)}\n`);
    return s;
  }

  private toolResult(p: Record<string, unknown>, pad: string): string {
    const id = str(p['id']);
    const isError = p['isError'] === true;
    if (this.shown.has(id) && !isError) return this.close();
    if (this.streamed.has(`${id}:out`) && !isError) return this.close();
    const content = str(p['content']).replace(/\n+$/, '');
    if (!content) return this.close();
    const lines = content.split('\n');
    const head = lines.slice(0, MAX_RESULT_LINES);
    const more = lines.length > head.length ? `\n${pad}  ${this.c('2', `… ${lines.length - head.length} more lines`)}` : '';
    const style = isError ? (l: string) => this.c('31', l) : (l: string) => this.c('2', l);
    return this.close() + this.lineStart() + this.out(`${this.indentLines(head.join('\n'), `${pad}  `, style)}${more}\n`);
  }
}

/** Stateless convenience for one-off lines (`--verbose` with `-p`): render a single completed event. */
export function renderEvent(ev: RenderEvent, o: RenderOptions): string[] {
  const text = new Renderer(o).event(ev);
  return text ? text.replace(/\n$/, '').split('\n') : [];
}
export function renderPartial(p: ChildPartial, r: Renderer): string { return r.partial(p); }
