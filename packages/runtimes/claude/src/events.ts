import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';
import { parseTestSummary } from '@weave-ai/shared';

export interface ClaudeParseState {
  sessionId: string | null;
  model: string | null;
  /** `result.result` when present, else the concatenation of assistant text blocks. */
  finalText: string | null;
  assistantText: string;
  structured: unknown;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null;
  /**
   * VS-462: the first API request of the turn, split into fresh (input + cache creation) and cached
   * (cache read) tokens. Captured from the first non-subagent `assistant` message's usage block,
   * before the `result` line's turn total supersedes it. Null when the stream carried no usage.
   */
  firstRequest: { freshTokens: number; cachedTokens: number } | null;
  /**
   * The size of the last API request this turn made, from the last `assistant` message that carried
   * a usage block: what it sent, what it wrote to cache and what it read back. That is the context
   * window's fill. The `result` message's usage is the same fields summed over every request the
   * turn made, so it is the turn's cost and not a size — see `usage` above.
   */
  contextTokens: number | null;
  costUsd: number | null;
  isError: boolean;
  errorMessage: string | null;
  numTurns: number | null;
  /** True once this turn's `result` line has been seen — the point past which stdin should close. */
  resultSeen: boolean;
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
    usage: null, firstRequest: null, contextTokens: null, costUsd: null, isError: false, errorMessage: null, numTurns: null,
    resultSeen: false,
  };
  /** tool_use id -> tool name, so tool_result lines can be classified. */
  const toolNames = new Map<string, string>();
  let sessionAnnounced = false;
  // VS-599: the `stream_event` state. `streamMessageId` is the id `message_start` announced; the
  // blocks it opened are kept in start order so a completed `assistant` block can be matched to the
  // stream index its deltas were reported under, giving both the same `partId`.
  let streamMessageId: string | null = null;
  const streamBlocks = new Map<string, Array<{ idx: number; type: string; toolId: string | null; consumed: boolean }>>();
  const pendingPartials: RuntimePartial[] = [];

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
      case 'stream_event': return streamEvent(msg);
      default: return [raw(type ?? 'unknown', msg, ts)];
    }
  }

  /**
   * VS-599: one `--include-partial-messages` line. It carries no persisted event — the completed
   * `assistant`/`user` lines still produce every persisted event — only the deltas and the block
   * bookkeeping, which `takePartials()` hands to `TurnSink.onPartial`. Shapes come from the
   * 2026-09-20 captured run (see design.md §1).
   */
  function streamEvent(msg: Json): RuntimeEvent[] {
    const ev = obj(msg['event']);
    if (!ev) return [];
    switch (str(ev['type'])) {
      case 'message_start': {
        const id = str(obj(ev['message'])?.['id']);
        if (id) { streamMessageId = id; if (!streamBlocks.has(id)) streamBlocks.set(id, []); }
        return [];
      }
      case 'content_block_start': {
        const idx = num(ev['index']);
        const block = obj(ev['content_block']);
        const kind = str(block?.['type']);
        if (streamMessageId && idx != null && kind) {
          const list = streamBlocks.get(streamMessageId) ?? [];
          if (!streamBlocks.has(streamMessageId)) streamBlocks.set(streamMessageId, list);
          list.push({ idx, type: kind, toolId: kind === 'tool_use' ? str(block?.['id']) : null, consumed: false });
        }
        return [];
      }
      case 'content_block_delta': {
        const idx = num(ev['index']);
        const delta = obj(ev['delta']);
        const kind = str(delta?.['type']);
        if (streamMessageId && idx != null) {
          const partId = `${streamMessageId}:${idx}`;
          if (kind === 'text_delta') {
            const text = str(delta?.['text']);
            if (text) pendingPartials.push({ kind: 'text', partId, messageId: streamMessageId, text });
          } else if (kind === 'thinking_delta') {
            const text = str(delta?.['thinking']);
            if (text) pendingPartials.push({ kind: 'thinking', partId, messageId: streamMessageId, text });
          } else if (kind === 'input_json_delta') {
            const text = str(delta?.['partial_json']);
            const toolId = streamBlocks.get(streamMessageId)?.find((b) => b.idx === idx)?.toolId ?? null;
            if (text) pendingPartials.push({ kind: 'tool_input', partId, ...(toolId ? { toolCallId: toolId } : {}), text });
          }
          // `signature_delta` (and any other delta type) is consumed here and never surfaced.
        }
        return [];
      }
      default:
        // content_block_stop, message_delta, message_stop: no event and no partial.
        return [];
    }
  }

  /**
   * The `partId` the completed block and its streamed partials share: `${message.id}:${block index}`.
   * A block is matched to the stream block whose type (and, for a tool, id) agrees, in start order;
   * with no recorded stream block the completed event carries no `partId`, leaving persisted events
   * byte-identical to a turn that never streamed.
   */
  function completedPartId(messageId: string, kind: string | null, toolId: string | null): string | null {
    if (!messageId) return null;
    const entry = streamBlocks.get(messageId)?.find((b) =>
      !b.consumed && b.type === kind && (kind !== 'tool_use' || b.toolId === toolId));
    if (!entry) return null;
    entry.consumed = true;
    return `${messageId}:${entry.idx}`;
  }

  /** The partials accumulated since the last call, then cleared. */
  function takePartials(): RuntimePartial[] {
    return pendingPartials.splice(0, pendingPartials.length);
  }

  function system(msg: Json, ts: string): RuntimeEvent[] {
    const subtype = str(msg['subtype']);
    // VS-454: Claude Code's own compaction signals, read from the installed 2.1.270 bundle.
    // `system`/`status` with `status: "compacting"` is emitted while compaction runs (the earlier
    // signal, so the chat can show the pause); `system`/`compact_boundary` carries the
    // `compact_metadata` (`trigger`, `pre_tokens`, `post_tokens`, …) once it finishes.
    if (subtype === 'compact_boundary') return [compactionCompleted(msg, ts)];
    if (subtype === 'status' && str(msg['status']) === 'compacting') {
      return [{ ts, type: 'session.compaction.started', payload: {} }];
    }
    if (subtype !== 'init') return [raw(`system.${subtype ?? 'unknown'}`, msg, ts)];
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

  /** The post-compaction boundary: `compact_metadata` in its wire snake_case, read defensively. */
  function compactionCompleted(msg: Json, ts: string): RuntimeEvent {
    const meta = obj(msg['compact_metadata']);
    const trigger = str(meta?.['trigger']);
    const pre = num(meta?.['pre_tokens']);
    const post = num(meta?.['post_tokens']);
    const dropped = num(meta?.['cumulative_dropped_tokens']);
    return {
      ts, type: 'session.compaction.completed',
      payload: {
        ...(trigger === 'auto' || trigger === 'manual' ? { trigger } : {}),
        ...(pre != null ? { preTokens: pre } : {}),
        ...(post != null ? { postTokens: post } : {}),
        ...(dropped != null ? { droppedTokens: dropped } : {}),
      },
    };
  }

  function assistant(msg: Json, ts: string): RuntimeEvent[] {
    const out: RuntimeEvent[] = [];
    const m = obj(msg['message']);
    if (!m) return [raw('assistant', msg, ts)];
    state.model = str(m['model']) ?? state.model;
    // Each assistant message carries the usage of the request that produced it, so the last one is
    // the turn's final context size. A message nested under a tool call is a sub-agent's: its
    // request measures a different conversation, and a turn that ends inside sub-agent work would
    // otherwise report the sub-agent's much smaller context as this session's.
    if (msg['parent_tool_use_id'] == null) {
      const u = obj(m['usage']);
      if (u) {
        // VS-462: the first request's own split, before later requests overwrite `contextTokens`.
        if (state.firstRequest == null) {
          state.firstRequest = {
            freshTokens: (num(u['input_tokens']) ?? 0) + (num(u['cache_creation_input_tokens']) ?? 0),
            cachedTokens: num(u['cache_read_input_tokens']) ?? 0,
          };
        }
        state.contextTokens =
          (num(u['input_tokens']) ?? 0) + (num(u['cache_creation_input_tokens']) ?? 0) + (num(u['cache_read_input_tokens']) ?? 0);
      }
    }
    const content = Array.isArray(m['content']) ? m['content'] : [];
    // VS-599: the message id the streamed partials were reported under, so a completed block can
    // carry the same `partId` and supersede its partial.
    const messageId = str(m['id']) ?? '';
    for (const blockRaw of content) {
      const b = obj(blockRaw);
      if (!b) continue;
      switch (str(b['type'])) {
        case 'text': {
          const text = str(b['text']) ?? '';
          if (!text) break;
          state.assistantText += (state.assistantText ? '\n' : '') + text;
          const partId = completedPartId(messageId, 'text', null);
          out.push({ ts, type: 'assistant.text', payload: { text, ...(partId ? { partId } : {}) } });
          break;
        }
        case 'thinking': {
          const think = str(b['thinking']) ?? '';
          const partId = completedPartId(messageId, 'thinking', null);
          out.push({ ts, type: 'assistant.thinking', payload: { text: truncate(think, 2000), redacted: think.length > 2000, ...(partId ? { partId } : {}) } });
          break;
        }
        case 'tool_use': {
          const id = str(b['id']) ?? '';
          const name = str(b['name']) ?? 'unknown';
          if (id) toolNames.set(id, name);
          const partId = completedPartId(messageId, 'tool_use', id || null);
          out.push({ ts, type: 'tool.call', payload: { id, name, input: b['input'], ...(partId ? { partId } : {}) } });
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
    // A `user` frame with string content is never a tool result (those always carry an array of
    // blocks) — under `--replay-user-messages` it can only be the CLI echoing a frame we wrote to
    // stdin back to us. That is an acknowledgement, not a fresh input, so it produces no event.
    if (m && typeof m['content'] === 'string') return [];
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
        const stdout = str(meta?.['stdout']) ?? text;
        const stderr = str(meta?.['stderr']) ?? '';
        // VS-328: read the test tally from the whole output, before it is size-bounded.
        const tests = parseTestSummary(stdout) ?? parseTestSummary(stderr);
        out.push({
          ts, type: 'command.executed',
          payload: { toolUseId: id, tool: name, stdout: truncate(stdout), stderr: truncate(stderr), isError, ...(tests ? { tests } : {}) },
        });
      }
    }
    return out.length > 0 ? out : [raw('user', msg, ts)];
  }

  function result(msg: Json, ts: string): RuntimeEvent[] {
    state.resultSeen = true;
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
    takePartials,
    get sessionAnnounced() { return sessionAnnounced; },
  };
}
