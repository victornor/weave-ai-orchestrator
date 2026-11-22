/**
 * Stream parser for `agy -p --output-format stream-json` (VS-995).
 *
 * Every line is `{"event": <type>, ...}`. Only the final `result` event is known from real bytes so
 * far — captured from 1.5.14 with no login:
 *   {"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out",
 *    "duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,
 *    "total_tokens":0},"finished_reason":"error"}}
 * plus the binary's own field tags `structured_output` and `denied_actions`. Every other event is
 * kept verbatim as `runtime.raw` until the owner capture (scripts/capture-agy-fixtures.sh) shows its
 * shape; nothing here guesses one.
 */
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';
import { isAuthFailureText } from './auth.js';

export interface AgyParseState {
  conversationId: string | null;
  finalText: string | null;
  structured: unknown;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; thinkingTokens: number } | null;
  resultSeen: boolean;
  isError: boolean;
  errorMessage: string | null;
  authFailed: boolean;
  finishedReason: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function createAgyParser() {
  const state: AgyParseState = {
    conversationId: null, finalText: null, structured: undefined, usage: null,
    resultSeen: false, isError: false, errorMessage: null, authFailed: false, finishedReason: null,
  };

  function onResult(r: Json, ts: string): RuntimeEvent[] {
    state.resultSeen = true;
    const conv = str(r['conversation_id']);
    if (conv) state.conversationId = conv;
    const response = str(r['response']);
    if (response) state.finalText = response;
    if (r['structured_output'] !== undefined && r['structured_output'] !== null) state.structured = r['structured_output'];
    state.finishedReason = str(r['finished_reason']);
    const u = obj(r['usage']);
    const out: RuntimeEvent[] = [];
    if (u) {
      state.usage = {
        inputTokens: num(u['input_tokens']), outputTokens: num(u['output_tokens']),
        cachedInputTokens: num(u['cache_read_tokens']), thinkingTokens: num(u['thinking_tokens']),
      };
      out.push({ ts, type: 'usage.delta', payload: { ...state.usage, basis: 'per_turn' } });
    }
    const denied = r['denied_actions'];
    if (Array.isArray(denied) && denied.length > 0) {
      out.push({ ts, type: 'error', payload: { severity: 'warning', message: truncate(`agy denied ${denied.length} action(s): ${JSON.stringify(denied)}`, 2000) } });
    }
    const status = str(r['status']);
    const error = str(r['error']);
    if ((status && status !== 'SUCCESS') || error) {
      state.isError = true;
      state.errorMessage = error ?? `agy result status ${status ?? 'unknown'}`;
      if (isAuthFailureText(error)) state.authFailed = true;
      out.push({ ts, type: 'error', payload: { message: truncate(state.errorMessage, 2000) } });
    }
    out.push({ ts, type: 'turn.completed', payload: { status, durationMs: Math.round(num(r['duration_seconds']) * 1000), numTurns: num(r['num_turns']), finishedReason: state.finishedReason, sessionId: state.conversationId } });
    return out;
  }

  function handle(line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const ts = new Date().toISOString();
    let msg: Json | null = null;
    try { msg = obj(JSON.parse(trimmed)); } catch { msg = null; }
    if (!msg) return [{ ts, type: 'runtime.raw', payload: { originalType: 'text', data: truncate(trimmed, 4000) } }];
    const type = str(msg['event']) ?? str(msg['type']) ?? 'unknown';
    if (type === 'result') {
      const r = obj(msg['result']);
      if (r) return onResult(r, ts);
    }
    return [{ ts, type: 'runtime.raw', payload: { originalType: type, data: msg } }];
  }

  return { state, handle };
}
