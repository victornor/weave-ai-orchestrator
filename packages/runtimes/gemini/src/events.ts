import type { RuntimeEvent } from '@openconductor/runtime-sdk';
import { truncate } from '@openconductor/runtime-sdk';

export interface GeminiParseState {
  sessionId: string | null;
  model: string | null;
  finalText: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null;
  isError: boolean;
  errorMessage: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const SHELL_TOOLS = new Set(['run_shell_command', 'shell']);
const EDIT_TOOLS = new Set(['replace', 'write_file', 'edit']);

/**
 * Stream parser for `gemini -o stream-json`.
 * Event shapes taken from the shipped gemini 0.58.0 bundle (`StreamJsonFormatter` emit sites):
 * `init`, `message` (role user|assistant, delta), `tool_use`, `tool_result`, `error`, `result`.
 */
export function createGeminiParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: GeminiParseState = { sessionId: null, model: null, finalText: null, usage: null, isError: false, errorMessage: null };
  const toolNames = new Map<string, string>();
  let assistantText = '';

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = str(msg['timestamp']) ?? new Date().toISOString();
    switch (str(msg['type'])) {
      case 'init':
        state.sessionId = str(msg['session_id']);
        state.model = str(msg['model']);
        return [{ ts, type: opts.resumed ? 'session.resumed' : 'session.started', payload: { sessionId: state.sessionId, model: state.model } }];
      case 'message': {
        const content = str(msg['content']) ?? '';
        if (str(msg['role']) !== 'assistant') return [raw('message.user', msg, ts)];
        assistantText += content;
        return content ? [{ ts, type: 'assistant.text', payload: { text: content, delta: msg['delta'] === true } }] : [];
      }
      case 'tool_use': {
        const id = str(msg['tool_id']) ?? '';
        const name = str(msg['tool_name']) ?? 'unknown';
        if (id) toolNames.set(id, name);
        return [{ ts, type: 'tool.call', payload: { id, name, input: msg['parameters'] } }];
      }
      case 'tool_result': {
        const id = str(msg['tool_id']) ?? '';
        const name = toolNames.get(id) ?? null;
        const isError = str(msg['status']) === 'error';
        const output = str(msg['output']) ?? '';
        const out: RuntimeEvent[] = [{ ts, type: 'tool.result', payload: { id, name, isError, content: truncate(output) } }];
        if (name && SHELL_TOOLS.has(name)) out.push({ ts, type: 'command.executed', payload: { id, tool: name, output: truncate(output), isError } });
        if (name && EDIT_TOOLS.has(name)) out.push({ ts, type: 'file.changed', payload: { id, tool: name, detail: truncate(output, 500) } });
        return out;
      }
      case 'error': {
        const severity = str(msg['severity']) ?? 'error';
        const message = str(msg['message']) ?? '';
        if (severity === 'error') { state.isError = true; state.errorMessage = message; }
        return [{ ts, type: 'error', payload: { severity, message: truncate(message, 2000) } }];
      }
      case 'result': {
        const out: RuntimeEvent[] = [];
        const stats = obj(msg['stats']);
        if (stats) {
          state.usage = {
            inputTokens: num(stats['input_tokens']) ?? 0,
            outputTokens: num(stats['output_tokens']) ?? 0,
            cachedInputTokens: num(stats['cached']) ?? 0,
          };
          out.push({ ts, type: 'usage.delta', payload: { ...state.usage, basis: 'per_turn', toolCalls: num(stats['tool_calls']) } });
        }
        if (str(msg['status']) === 'error') {
          state.isError = true;
          state.errorMessage = str(obj(msg['error'])?.['message']) ?? state.errorMessage ?? 'gemini reported an error';
          out.push({ ts, type: 'error', payload: { message: truncate(state.errorMessage, 2000), type: str(obj(msg['error'])?.['type']) } });
        }
        state.finalText = assistantText.length > 0 ? assistantText : null;
        out.push({ ts, type: 'turn.completed', payload: { status: str(msg['status']), durationMs: num(stats?.['duration_ms']), sessionId: state.sessionId } });
        return out;
      }
      default:
        return [raw(str(msg['type']) ?? 'unknown', msg, ts)];
    }
  }

  /** Gemini can die before emitting `result`; call this once the process has exited. */
  function finish(): void {
    if (state.finalText == null && assistantText.length > 0) state.finalText = assistantText;
  }

  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle, finish };
}
