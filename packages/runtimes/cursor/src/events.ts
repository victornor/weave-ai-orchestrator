import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';
import { parseTestSummary } from '@weave-ai/shared';

export interface CursorParseState {
  sessionId: string | null;
  model: string | null;
  finalText: string | null;
  assistantText: string;
  isError: boolean;
  errorMessage: string | null;
  resultSeen: boolean;
  /** VS-600: the delta text of the assistant message being streamed, awaiting its flush. */
  partialBuffer: string;
  /** The `partId` the current message's deltas and its completed event share. */
  currentPartId: string | null;
  /** Monotonic per-message counter behind the synthesized `partId`s. */
  partialSeq: number;
}

export interface CursorParseOptions {
  resumed?: boolean;
  /** VS-600: `--stream-partial-output` is on, so `assistant` text events may be deltas. */
  streamPartial?: boolean;
  /** Called for each text delta while streaming. */
  onPartial?: (p: RuntimePartial) => void;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const SHELL_KEYS = new Set(['shellToolCall', 'bashToolCall']);
const WRITE_KEYS = new Set(['writeToolCall', 'editToolCall']);

/**
 * Stream parser for `cursor-agent -p --output-format stream-json`.
 * Event shapes transcribed from Cursor CLI docs (2026-09-09): system/init, user, assistant,
 * tool_call started/completed, result. SYNTHETIC fixtures — not a live recording.
 */
export function createCursorParser(opts: CursorParseOptions = {}) {
  const state: CursorParseState = {
    sessionId: null, model: null, finalText: null, assistantText: '',
    isError: false, errorMessage: null, resultSeen: false,
    partialBuffer: '', currentPartId: null, partialSeq: 0,
  };

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = str(msg['timestamp']) ?? new Date().toISOString();
    const sid = str(msg['session_id']);
    if (sid && !state.sessionId) state.sessionId = sid;

    switch (str(msg['type'])) {
      case 'system': return system(msg, ts);
      case 'assistant': return assistant(msg, ts);
      case 'user': return [raw('user', msg, ts)];
      case 'tool_call': return toolCall(msg, ts);
      case 'result': return result(msg, ts);
      default: return [raw(str(msg['type']) ?? 'unknown', msg, ts)];
    }
  }

  function system(msg: Json, ts: string): RuntimeEvent[] {
    if (str(msg['subtype']) !== 'init') return [raw(`system.${str(msg['subtype']) ?? 'unknown'}`, msg, ts)];
    state.model = str(msg['model']) ?? state.model;
    return [{
      ts, type: opts.resumed ? 'session.resumed' : 'session.started',
      payload: { sessionId: state.sessionId, model: state.model, cwd: str(msg['cwd']), permissionMode: str(msg['permissionMode']) },
    }];
  }

  function nextPartId(): string {
    return `cursor:msg:${state.partialSeq++}`;
  }

  /**
   * VS-600: with `--stream-partial-output`, cursor-agent writes one `assistant` event per text delta
   * and, before each tool call and at turn end, flushes the whole accumulated model-call text as one
   * `assistant` event. A flush carries `model_call_id` (at a tool call) or no `timestamp_ms` (at turn
   * end); a delta carries `timestamp_ms` and neither of those. A flush whose text equals the buffer
   * is also caught by equality, so the discriminator survives a missing `model_call_id`.
   */
  function isFlush(msg: Json, text: string): boolean {
    if (str(msg['model_call_id']) !== null) return true;
    if (msg['timestamp_ms'] == null) return true;
    return state.partialBuffer.length > 0 && text === state.partialBuffer;
  }

  function assistant(msg: Json, ts: string): RuntimeEvent[] {
    const m = obj(msg['message']);
    const content = Array.isArray(m?.['content']) ? m['content'] : [];
    const blocks: string[] = [];
    for (const blockRaw of content) {
      const b = obj(blockRaw);
      if (!b) continue;
      const text = str(b['text']) ?? '';
      if (text) blocks.push(text);
    }
    if (blocks.length === 0) return [raw('assistant', msg, ts)];

    if (!opts.streamPartial) {
      const out: RuntimeEvent[] = [];
      for (const text of blocks) {
        state.assistantText += (state.assistantText ? '\n' : '') + text;
        out.push({ ts, type: 'assistant.text', payload: { text } });
      }
      return out;
    }

    // One `assistant` event carries one text block in this mode; its text is the delta or the flush.
    const text = blocks.join('\n');
    if (isFlush(msg, text)) {
      const partId = state.currentPartId ?? nextPartId();
      state.currentPartId = null;
      state.partialBuffer = '';
      state.assistantText += (state.assistantText ? '\n' : '') + text;
      return [{ ts, type: 'assistant.text', payload: { text, partId } }];
    }
    if (state.currentPartId === null) state.currentPartId = nextPartId();
    state.partialBuffer += text;
    opts.onPartial?.({ kind: 'text', partId: state.currentPartId, text });
    return [];
  }

  function toolCall(msg: Json, ts: string): RuntimeEvent[] {
    const subtype = str(msg['subtype']);
    const id = str(msg['call_id']) ?? '';
    const tc = obj(msg['tool_call']) ?? {};
    const key = Object.keys(tc)[0] ?? 'unknown';
    const body = obj(tc[key]) ?? {};
    const args = obj(body['args']) ?? {};
    const name = str(obj(body)?.['name']) ?? key.replace(/ToolCall$/, '') ?? 'unknown';

    if (subtype === 'started') {
      return [{ ts, type: 'tool.call', payload: { id, name, input: args } }];
    }
    if (subtype === 'completed') {
      const res = obj(body['result']);
      const success = obj(res?.['success']);
      const isError = Boolean(res?.['error']) && !success;
      const content = str(success?.['content']) ?? JSON.stringify(res ?? {});
      const out: RuntimeEvent[] = [{ ts, type: 'tool.result', payload: { id, name, isError, content: truncate(content) } }];
      if (SHELL_KEYS.has(key) || name === 'shell' || name === 'bash') {
        // VS-328: read the test tally from the whole output, before it is size-bounded.
        const tests = parseTestSummary(content);
        out.push({ ts, type: 'command.executed', payload: { id, tool: name, output: truncate(content), isError, ...(tests ? { tests } : {}) } });
      }
      if (WRITE_KEYS.has(key) || name === 'write' || name === 'edit') {
        const path = str(args['path']) ?? str(success?.['path']);
        if (path) out.push({ ts, type: 'file.changed', payload: { id, path, tool: name } });
      }
      return out;
    }
    return [raw(`tool_call.${subtype ?? 'unknown'}`, msg, ts)];
  }

  function result(msg: Json, ts: string): RuntimeEvent[] {
    state.resultSeen = true;
    const text = str(msg['result']);
    if (text) state.finalText = text;
    else if (state.assistantText) state.finalText = state.assistantText;
    if (msg['is_error'] === true || str(msg['subtype']) === 'error') {
      state.isError = true;
      state.errorMessage = str(msg['result']) ?? 'cursor turn failed';
    }
    return [{
      ts, type: 'turn.completed',
      payload: { sessionId: state.sessionId, durationMs: num(msg['duration_ms']), isError: state.isError },
    }];
  }

  function finish(): void {
    // A stream cut off before its flush: keep the deltas' text in the fallback final text. The
    // partial itself is discarded by the engine when the turn ends, as for every runtime.
    if (opts.streamPartial && state.partialBuffer.length > 0) {
      state.assistantText += (state.assistantText ? '\n' : '') + state.partialBuffer;
      state.partialBuffer = '';
      state.currentPartId = null;
    }
    if (state.finalText == null && state.assistantText.length > 0) state.finalText = state.assistantText;
  }

  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle, finish };
}
