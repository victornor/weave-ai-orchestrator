import type { RuntimeEvent } from '@agent-conductor/runtime-sdk';
import { truncate } from '@agent-conductor/runtime-sdk';

export interface CodexParseState {
  threadId: string | null;
  finalText: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null;
  isError: boolean;
  errorMessage: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Stream parser for `codex exec --json` JSONL.
 * Event tags (`thread.started`, `turn.started|completed|failed`, `item.started|updated|completed`)
 * and item kinds (`agent_message`, `reasoning`, `command_execution`, `file_change`,
 * `mcp_tool_call`, `web_search`, `todo_list`, `error`) verified against codex 0.150.1.
 */
export function createCodexParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: CodexParseState = { threadId: null, finalText: null, usage: null, isError: false, errorMessage: null };
  const messages: string[] = [];

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = new Date().toISOString();
    switch (str(msg['type'])) {
      case 'thread.started': {
        state.threadId = str(msg['thread_id']);
        return [{ ts, type: opts.resumed ? 'session.resumed' : 'session.started', payload: { threadId: state.threadId } }];
      }
      case 'turn.started':
        return [{ ts, type: 'turn.started', payload: {} }];
      case 'item.started':
      case 'item.updated':
        return [raw(str(msg['type'])!, msg, ts)];
      case 'item.completed':
        return item(obj(msg['item']), ts);
      case 'turn.completed': {
        const out: RuntimeEvent[] = [];
        const u = obj(msg['usage']);
        if (u) {
          state.usage = {
            inputTokens: num(u['input_tokens']) ?? 0,
            outputTokens: num(u['output_tokens']) ?? 0,
            cachedInputTokens: num(u['cached_input_tokens']) ?? 0,
          };
          out.push({ ts, type: 'usage.delta', payload: { ...state.usage, basis: 'per_turn' } });
        }
        state.finalText = messages.length > 0 ? messages[messages.length - 1]! : null;
        out.push({ ts, type: 'turn.completed', payload: { threadId: state.threadId } });
        return out;
      }
      case 'turn.failed': {
        state.isError = true;
        state.errorMessage = str(obj(msg['error'])?.['message']) ?? 'codex turn failed';
        state.finalText = messages.length > 0 ? messages[messages.length - 1]! : null;
        return [
          { ts, type: 'error', payload: { message: truncate(state.errorMessage, 2000) } },
          { ts, type: 'turn.completed', payload: { threadId: state.threadId, failed: true } },
        ];
      }
      case 'error': {
        state.isError = true;
        state.errorMessage = str(msg['message']) ?? state.errorMessage;
        return [{ ts, type: 'error', payload: { message: truncate(str(msg['message']) ?? '', 2000) } }];
      }
      default:
        return [raw(str(msg['type']) ?? 'unknown', msg, ts)];
    }
  }

  function item(it: Json | null, ts: string): RuntimeEvent[] {
    if (!it) return [];
    const id = str(it['id']) ?? '';
    switch (str(it['item_type'])) {
      case 'agent_message': {
        const text = str(it['text']) ?? '';
        if (text) messages.push(text);
        return [{ ts, type: 'assistant.text', payload: { id, text } }];
      }
      case 'reasoning':
        return [{ ts, type: 'assistant.thinking', payload: { id, text: truncate(str(it['text']) ?? '', 2000) } }];
      case 'command_execution': {
        const exitCode = num(it['exit_code']);
        return [{
          ts, type: 'command.executed',
          payload: { id, command: str(it['command']), exitCode, status: str(it['status']), output: truncate(str(it['aggregated_output']) ?? '') },
        }];
      }
      case 'file_change': {
        const changes = Array.isArray(it['changes']) ? it['changes'] : [];
        return changes.map((c) => ({ ts, type: 'file.changed' as const, payload: { id, ...(obj(c) ?? { change: c }) } }));
      }
      case 'mcp_tool_call':
        return [
          { ts, type: 'tool.call', payload: { id, server: str(it['server']), name: str(it['tool']), input: it['arguments'] } },
          { ts, type: 'tool.result', payload: { id, status: str(it['status']), isError: str(it['status']) === 'failed', content: truncate(JSON.stringify(it['result'] ?? null)) } },
        ];
      case 'todo_list':
        return [{ ts, type: 'plan.proposed', payload: { id, items: it['items'] } }];
      case 'error': {
        state.isError = true;
        state.errorMessage = str(it['message']) ?? state.errorMessage;
        return [{ ts, type: 'error', payload: { id, message: truncate(str(it['message']) ?? '', 2000) } }];
      }
      default:
        return [raw(`item.${str(it['item_type']) ?? 'unknown'}`, it, ts)];
    }
  }

  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return { state, handle };
}
