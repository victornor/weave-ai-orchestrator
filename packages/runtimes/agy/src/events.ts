/**
 * Stream parser for `agy -p --output-format stream-json` (VS-995). Every shape below is read from
 * real agy 1.5.14 bytes (fixtures/README.md), not guessed:
 *
 *   {"event":"init","conversation_id":…,"init":{"model","cwd","tools":[…],"permission_mode","json_schema"}}
 *   {"event":"step_update","step_update":{"conversation_id","step_index","state":"ACTIVE"|"DONE","step_type",…}}
 *       step_type user_input | system_message | finish            — bookkeeping, kept as runtime.raw
 *       step_type agent_response  + text_delta (the step's whole text) + usage (that request's tokens)
 *       step_type tool            + tool_name + tool_info{name, parameters, output (DONE only)}
 *                                   an MCP call is tool_name `call_mcp_tool` with ServerName/ToolName/Arguments
 *   {"event":"result","result":{"conversation_id","status","response","structured_output","usage",…}}
 *
 * Usage is taken from the steps, never from `result.usage`: the result's usage (and duration and
 * num_turns) is cumulative over the whole conversation — turn 2 of the capture reports turn 1's
 * tokens plus its own. A step's `input_tokens` excludes its `cache_read_tokens` (`total_tokens` is
 * input + output, and a step can read more from cache than it sends fresh), so the turn's
 * `inputTokens` here is input + cache reads, with the cache reads also in `cachedInputTokens`.
 */
import type { RuntimeEvent } from '@weave-ai/runtime-sdk';
import { truncate } from '@weave-ai/runtime-sdk';
import { isAuthFailureText } from './auth.js';

export interface AgyTurnUsage {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; thinkingTokens: number;
  /** The last model request's input + cache reads: how full the context is. */
  contextTokens: number;
  /** The turn's first model request, split fresh vs cached. */
  firstRequest: { freshTokens: number; cachedTokens: number };
}

export interface AgyParseState {
  conversationId: string | null;
  model: string | null;
  finalText: string | null;
  structured: unknown;
  usage: AgyTurnUsage | null;
  /** The conversation-wide totals agy's `result` reports; informational only. */
  conversationUsage: Record<string, number> | null;
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

/** `call_mcp_tool` names the server and tool in its parameters; show it the way other runtimes do. */
function toolIdentity(toolName: string, params: Json | null): { name: string; input: unknown } {
  if (toolName === 'call_mcp_tool' && params) {
    const server = str(params['ServerName']);
    const tool = str(params['ToolName']);
    if (server && tool) return { name: `mcp__${server}__${tool}`, input: params['Arguments'] ?? {} };
  }
  return { name: toolName, input: params ?? {} };
}

export function createAgyParser(opts: { resumed?: boolean } = {}) {
  const state: AgyParseState = {
    conversationId: null, model: null, finalText: null, structured: undefined, usage: null, conversationUsage: null,
    resultSeen: false, isError: false, errorMessage: null, authFailed: false, finishedReason: null,
  };
  const callsAnnounced = new Set<number>();
  let lastText: string | null = null;

  function addUsage(u: Json): void {
    const fresh = num(u['input_tokens']);
    const cached = num(u['cache_read_tokens']);
    const prev = state.usage;
    state.usage = {
      inputTokens: (prev?.inputTokens ?? 0) + fresh + cached,
      outputTokens: (prev?.outputTokens ?? 0) + num(u['output_tokens']),
      cachedInputTokens: (prev?.cachedInputTokens ?? 0) + cached,
      thinkingTokens: (prev?.thinkingTokens ?? 0) + num(u['thinking_tokens']),
      contextTokens: fresh + cached,
      firstRequest: prev?.firstRequest ?? { freshTokens: fresh, cachedTokens: cached },
    };
  }

  function onStep(s: Json, ts: string, raw: Json): RuntimeEvent[] {
    const conv = str(s['conversation_id']);
    if (conv) state.conversationId = conv;
    const index = num(s['step_index']);
    const id = `step-${index}`;
    const stepState = str(s['state']);
    switch (str(s['step_type'])) {
      case 'agent_response': {
        const out: RuntimeEvent[] = [];
        const u = obj(s['usage']);
        if (u) addUsage(u);
        const text = str(s['text_delta']);
        if (text && text.trim().length > 0) {
          lastText = text;
          out.push({ ts, type: 'assistant.text', payload: { text, partId: id } });
        }
        return out;
      }
      case 'tool': {
        const info = obj(s['tool_info']);
        const { name, input } = toolIdentity(str(s['tool_name']) ?? str(info?.['name']) ?? 'unknown', obj(info?.['parameters']));
        const out: RuntimeEvent[] = [];
        if (!callsAnnounced.has(index)) {
          callsAnnounced.add(index);
          out.push({ ts, type: 'tool.call', payload: { id, name, input } });
        }
        if (stepState !== 'ACTIVE') {
          // Only DONE is captured; any other terminal state is treated as a failed call.
          const output = info?.['output'];
          out.push({ ts, type: 'tool.result', payload: { id, name, isError: stepState !== 'DONE', content: truncate(typeof output === 'string' ? output : JSON.stringify(output ?? null)) } });
        }
        return out;
      }
      default:
        return [{ ts, type: 'runtime.raw', payload: { originalType: `step_update.${str(s['step_type']) ?? 'unknown'}`, data: raw } }];
    }
  }

  function onResult(r: Json, ts: string): RuntimeEvent[] {
    state.resultSeen = true;
    const conv = str(r['conversation_id']);
    if (conv) state.conversationId = conv;
    const response = str(r['response']);
    state.finalText = response && response.length > 0 ? response : lastText;
    if (r['structured_output'] !== undefined && r['structured_output'] !== null) state.structured = r['structured_output'];
    state.finishedReason = str(r['finished_reason']);
    const cu = obj(r['usage']);
    if (cu) state.conversationUsage = Object.fromEntries(Object.entries(cu).map(([k, v]) => [k, num(v)]));
    const out: RuntimeEvent[] = [];
    if (state.usage) {
      const { inputTokens, outputTokens, cachedInputTokens, thinkingTokens, contextTokens } = state.usage;
      out.push({ ts, type: 'usage.delta', payload: { inputTokens, outputTokens, cachedInputTokens, thinkingTokens, contextTokens, basis: 'per_turn' } });
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
    out.push({ ts, type: 'turn.completed', payload: { status, finishedReason: state.finishedReason, sessionId: state.conversationId, conversationUsage: state.conversationUsage } });
    return out;
  }

  function handle(line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const ts = new Date().toISOString();
    let msg: Json | null = null;
    try { msg = obj(JSON.parse(trimmed)); } catch { msg = null; }
    if (!msg) return [{ ts, type: 'runtime.raw', payload: { originalType: 'text', data: truncate(trimmed, 4000) } }];
    const type = str(msg['event']) ?? 'unknown';
    if (type === 'init') {
      const init = obj(msg['init']);
      const conv = str(msg['conversation_id']);
      if (conv) state.conversationId = conv;
      state.model = str(init?.['model']) ?? state.model;
      return [{
        ts, type: opts.resumed ? 'session.resumed' : 'session.started',
        payload: { sessionId: state.conversationId, model: state.model, cwd: str(init?.['cwd']), permissionMode: str(init?.['permission_mode']), tools: init?.['tools'] },
      }];
    }
    if (type === 'step_update') {
      const s = obj(msg['step_update']);
      if (s) return onStep(s, ts, msg);
    }
    if (type === 'result') {
      const r = obj(msg['result']);
      if (r) return onResult(r, ts);
    }
    return [{ ts, type: 'runtime.raw', payload: { originalType: type, data: msg } }];
  }

  return { state, handle };
}
