import type { RuntimeEvent } from '@openconductor/runtime-sdk';
import { truncate } from '@openconductor/runtime-sdk';

export interface ClaudeParseState {
  sessionId: string | null;
  model: string | null;
  /** `result.result` when present, else the concatenation of assistant text blocks. */
  finalText: string | null;
  assistantText: string;
  structured: unknown;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null;
  costUsd: number | null;
  isError: boolean;
  errorMessage: string | null;
  numTurns: number | null;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'PowerShell']);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Stream parser for `claude -p --output-format stream-json --verbose`.
 * Feed it one JSON line at a time; it returns the normalized events for that line
 * and accumulates the turn result in `state`.
 */
export function createClaudeParser(opts: { resumed: boolean } = { resumed: false }) {
  const state: ClaudeParseState = {
    sessionId: null, model: null, finalText: null, assistantText: '', structured: undefined,
    usage: null, costUsd: null, isError: false, errorMessage: null, numTurns: null,
  };
  /** tool_use id -> tool name, so tool_result lines can be classified. */
  const toolNames = new Map<string, string>();
  let sessionAnnounced = false;

  function handle(line: string): RuntimeEvent[] {
    let msg: Json | null;
    try { msg = obj(JSON.parse(line)); } catch { return [raw('unparseable', { line: truncate(line, 2000) })]; }
    if (!msg) return [];
    const ts = str(msg['timestamp']) ?? new Date().toISOString();
    const type = str(msg['type']);
    const sid = str(msg['session_id']);
    if (sid && !state.sessionId) state.sessionId = sid;

    switch (type) {
      case 'system': return system(msg, ts);
      case 'assistant': return assistant(msg, ts);
      case 'user': return user(msg, ts);
      case 'result': return result(msg, ts);
      default: return [raw(type ?? 'unknown', msg, ts)];
    }
  }

  function system(msg: Json, ts: string): RuntimeEvent[] {
    if (str(msg['subtype']) !== 'init') return [raw(`system.${str(msg['subtype']) ?? 'unknown'}`, msg, ts)];
    state.model = str(msg['model']) ?? state.model;
    sessionAnnounced = true;
    return [{
      ts, type: opts.resumed ? 'session.resumed' : 'session.started',
      payload: {
        sessionId: state.sessionId, model: state.model, cwd: str(msg['cwd']),
        permissionMode: str(msg['permissionMode']), tools: msg['tools'], mcpServers: msg['mcp_servers'],
      },
    }];
  }

  function assistant(msg: Json, ts: string): RuntimeEvent[] {
    const out: RuntimeEvent[] = [];
    const m = obj(msg['message']);
    if (!m) return [raw('assistant', msg, ts)];
    state.model = str(m['model']) ?? state.model;
    const content = Array.isArray(m['content']) ? m['content'] : [];
    for (const blockRaw of content) {
      const b = obj(blockRaw);
      if (!b) continue;
      switch (str(b['type'])) {
        case 'text': {
          const text = str(b['text']) ?? '';
          if (!text) break;
          state.assistantText += (state.assistantText ? '\n' : '') + text;
          out.push({ ts, type: 'assistant.text', payload: { text } });
          break;
        }
        case 'thinking': {
          const think = str(b['thinking']) ?? '';
          out.push({ ts, type: 'assistant.thinking', payload: { text: truncate(think, 2000), redacted: think.length > 2000 } });
          break;
        }
        case 'tool_use': {
          const id = str(b['id']) ?? '';
          const name = str(b['name']) ?? 'unknown';
          if (id) toolNames.set(id, name);
          out.push({ ts, type: 'tool.call', payload: { id, name, input: b['input'] } });
          if (EDIT_TOOLS.has(name)) {
            const path = str(obj(b['input'])?.['file_path'] ?? obj(b['input'])?.['notebook_path']);
            if (path) out.push({ ts, type: 'file.changed', payload: { path, tool: name, toolUseId: id } });
          }
          break;
        }
        default:
          out.push(raw(`assistant.${str(b['type']) ?? 'block'}`, b, ts));
      }
    }
    return out;
  }

  function user(msg: Json, ts: string): RuntimeEvent[] {
    const out: RuntimeEvent[] = [];
    const m = obj(msg['message']);
    const content = m && Array.isArray(m['content']) ? m['content'] : [];
    for (const blockRaw of content) {
      const b = obj(blockRaw);
      if (!b || str(b['type']) !== 'tool_result') continue;
      const id = str(b['tool_use_id']) ?? '';
      const name = toolNames.get(id) ?? null;
      const isError = b['is_error'] === true;
      const text = typeof b['content'] === 'string' ? b['content'] : JSON.stringify(b['content'] ?? null);
      out.push({ ts, type: 'tool.result', payload: { id, name, isError, content: truncate(text) } });
      if (name && SHELL_TOOLS.has(name)) {
        const meta = obj(msg['tool_use_result']);
        out.push({
          ts, type: 'command.executed',
          payload: { toolUseId: id, tool: name, stdout: truncate(str(meta?.['stdout']) ?? text), stderr: truncate(str(meta?.['stderr']) ?? ''), isError },
        });
      }
    }
    return out.length > 0 ? out : [raw('user', msg, ts)];
  }

  function result(msg: Json, ts: string): RuntimeEvent[] {
    const out: RuntimeEvent[] = [];
    const u = obj(msg['usage']);
    if (u) {
      state.usage = {
        inputTokens: (num(u['input_tokens']) ?? 0) + (num(u['cache_creation_input_tokens']) ?? 0),
        outputTokens: num(u['output_tokens']) ?? 0,
        cachedInputTokens: num(u['cache_read_input_tokens']) ?? 0,
      };
      out.push({ ts, type: 'usage.delta', payload: { ...state.usage, basis: 'per_turn' } });
    }
    state.costUsd = num(msg['total_cost_usd']);
    state.numTurns = num(msg['num_turns']);
    state.isError = msg['is_error'] === true || (str(msg['subtype']) ?? 'success') !== 'success';
    if ('structured_output' in msg) state.structured = msg['structured_output'];
    state.finalText = str(msg['result']) ?? (state.assistantText || null);

    const denials = Array.isArray(msg['permission_denials']) ? msg['permission_denials'] : [];
    for (const d of denials) out.push({ ts, type: 'tool.denied', payload: obj(d) ?? { detail: d } });

    if (state.isError) {
      state.errorMessage = str(msg['result']) ?? str(msg['api_error_status']) ?? str(msg['subtype']) ?? 'claude reported an error';
      out.push({ ts, type: 'error', payload: { message: truncate(state.errorMessage, 2000), subtype: str(msg['subtype']) } });
    }
    out.push({
      ts, type: 'turn.completed',
      payload: {
        subtype: str(msg['subtype']), numTurns: state.numTurns, durationMs: num(msg['duration_ms']),
        stopReason: str(msg['stop_reason']), costUsd: state.costUsd, sessionId: state.sessionId,
      },
    });
    return out;
  }

  function raw(originalType: string, payload: unknown, ts = new Date().toISOString()): RuntimeEvent {
    return { ts, type: 'runtime.raw', payload: { originalType, data: payload } };
  }

  return {
    state,
    handle,
    get sessionAnnounced() { return sessionAnnounced; },
  };
}
