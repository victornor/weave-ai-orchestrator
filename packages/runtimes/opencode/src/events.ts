import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';

export interface OpenCodeParseState {
  sessionId: string | null;
  finalText: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null;
  /**
   * Size of the last `step_finish` request: input + cache.write + cache.read. The `usage`
   * totals above sum every step and are not a context size. Null when the stream reported
   * no `tokens` object.
   */
  contextTokens: number | null;
  costUsd: number | null;
  isError: boolean;
  errorMessage: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const SHELL_TOOLS = new Set(['bash', 'shell']);
const EDIT_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit']);

/**
 * Stream parser for `opencode run --format json`.
 * Verified against opencode 1.18.27: every line is `{type, timestamp, sessionID, part}`
 * with part kinds `step-start`, `text`, `tool`, `step-finish`; errors carry `error` instead.
 * OpenCode emits no terminal event, so `finish()` closes the turn.
 */
export function createOpenCodeParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: OpenCodeParseState = { sessionId: null, finalText: null, usage: null, contextTokens: null, costUsd: null, isError: false, errorMessage: null };
  const textByMessage = new Map<string, string[]>();
  let lastMessageId: string | null = null;
  let announced = false;
  let tokens = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let sawTokens = false;

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = tsOf(msg);
    const out: RuntimeEvent[] = [];
    const sid = str(msg['sessionID']);
    if (sid && !state.sessionId) {
      state.sessionId = sid;
      announced = true;
      out.push({ ts, type: opts.resumed ? 'session.resumed' : 'session.started', payload: { sessionId: sid } });
    }
    const part = obj(msg['part']);
    switch (str(msg['type'])) {
      case 'step_start':
        out.push({ ts, type: 'turn.started', payload: { messageId: str(part?.['messageID']) } });
        break;
      case 'text': {
        const text = str(part?.['text']) ?? '';
        const mid = str(part?.['messageID']) ?? '';
        if (text) {
          lastMessageId = mid;
          const acc = textByMessage.get(mid) ?? [];
          acc.push(text);
          textByMessage.set(mid, acc);
          out.push({ ts, type: 'assistant.text', payload: { text, messageId: mid } });
        }
        break;
      }
      case 'reasoning': {
        const think = str(part?.['text']) ?? '';
        if (think) out.push({ ts, type: 'assistant.thinking', payload: { text: truncate(think, 2000), redacted: think.length > 2000 } });
        break;
      }
      case 'tool_use':
        out.push(...tool(part, ts));
        break;
      case 'step_finish': {
        const t = obj(part?.['tokens']);
        if (t) {
          sawTokens = true;
          const cache = obj(t['cache']);
          const input = num(t['input']) ?? 0;
          const write = num(cache?.['write']) ?? 0;
          const read = num(cache?.['read']) ?? 0;
          tokens = {
            inputTokens: tokens.inputTokens + input,
            outputTokens: tokens.outputTokens + (num(t['output']) ?? 0),
            cachedInputTokens: tokens.cachedInputTokens + read,
          };
          state.usage = { ...tokens };
          state.contextTokens = input + write + read;
          out.push({ ts, type: 'usage.delta', payload: { ...tokens, basis: 'per_turn', reason: str(part?.['reason']) } });
        }
        const cost = num(part?.['cost']);
        if (cost != null) state.costUsd = (state.costUsd ?? 0) + cost;
        break;
      }
      case 'error': {
        state.isError = true;
        const err = obj(msg['error']);
        state.errorMessage = str(obj(err?.['data'])?.['message']) ?? str(err?.['name']) ?? 'opencode error';
        out.push({ ts, type: 'error', payload: { name: str(err?.['name']), message: truncate(state.errorMessage, 2000) } });
        break;
      }
      default:
        out.push(raw(str(msg['type']) ?? 'unknown', msg, ts));
    }
    return out;
  }

  function tool(part: Json | null, ts: string): RuntimeEvent[] {
    if (!part) return [];
    const name = str(part['tool']) ?? 'unknown';
    const id = str(part['callID']) ?? str(part['id']) ?? '';
    const st = obj(part['state']);
    const status = str(st?.['status']) ?? 'unknown';
    const out: RuntimeEvent[] = [{ ts, type: 'tool.call', payload: { id, name, input: st?.['input'], title: str(st?.['title']) } }];
    if (status === 'completed' || status === 'error') {
      const output = str(st?.['output']) ?? '';
      const isError = status === 'error';
      out.push({ ts, type: 'tool.result', payload: { id, name, status, isError, content: truncate(output) } });
      if (SHELL_TOOLS.has(name)) {
        const meta = obj(st?.['metadata']);
        out.push({ ts, type: 'command.executed', payload: { id, command: str(obj(st?.['input'])?.['command']), exitCode: num(meta?.['exit']), output: truncate(output), isError } });
      }
      if (EDIT_TOOLS.has(name)) {
        const path = str(obj(st?.['input'])?.['filePath'] ?? obj(st?.['input'])?.['file_path'] ?? obj(st?.['input'])?.['path']);
        if (path) out.push({ ts, type: 'file.changed', payload: { id, path, tool: name } });
      }
    }
    return out;
  }

  /** OpenCode's stream just ends; call this once the process has exited. */
  function finish(): RuntimeEvent[] {
    const texts = lastMessageId ? textByMessage.get(lastMessageId) ?? [] : [];
    state.finalText = texts.length > 0 ? texts.join('') : null;
    if (!sawTokens) state.usage = null;
    return [{ ts: new Date().toISOString(), type: 'turn.completed', payload: { sessionId: state.sessionId, failed: state.isError } }];
  }

  function tsOf(msg: Json): string {
    const t = num(msg['timestamp']);
    return t != null ? new Date(t).toISOString() : new Date().toISOString();
  }
  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle, finish, get sessionAnnounced() { return announced; } };
}
