import type { RuntimeEvent } from '@agent-conductor/runtime-sdk';
import { truncate } from '@agent-conductor/runtime-sdk';

export interface CursorParseState {
  sessionId: string | null;
  model: string | null;
  finalText: string | null;
  assistantText: string;
  isError: boolean;
  errorMessage: string | null;
  resultSeen: boolean;
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
export function createCursorParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: CursorParseState = {
    sessionId: null, model: null, finalText: null, assistantText: '',
    isError: false, errorMessage: null, resultSeen: false,
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

  function assistant(msg: Json, ts: string): RuntimeEvent[] {
    const m = obj(msg['message']);
    const content = Array.isArray(m?.['content']) ? m['content'] : [];
    const out: RuntimeEvent[] = [];
    for (const blockRaw of content) {
      const b = obj(blockRaw);
      if (!b) continue;
      const text = str(b['text']) ?? '';
      if (!text) continue;
      state.assistantText += (state.assistantText ? '\n' : '') + text;
      out.push({ ts, type: 'assistant.text', payload: { text } });
    }
    return out.length > 0 ? out : [raw('assistant', msg, ts)];
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
        out.push({ ts, type: 'command.executed', payload: { id, tool: name, output: truncate(content), isError } });
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
    if (state.finalText == null && state.assistantText.length > 0) state.finalText = state.assistantText;
  }

  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle, finish };
}
