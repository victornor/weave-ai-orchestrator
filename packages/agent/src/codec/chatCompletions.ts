import type { AgentError, ContentBlock, Message, Usage } from '../types.js';

export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface RequestOptions { temperature?: number; topP?: number; maxOutputTokens?: number; contextWindowTokens?: number }

/**
 * The request body for one step. Only parameters the user set are present: a value nobody chose is
 * not sent, so the provider's own default applies. The output cap is always `max_tokens`, the name
 * every probed endpoint honoured (`max_completion_tokens` was ignored by one of them).
 */
export function buildRequest(input: { model: string; system: string; messages: Message[]; tools: ToolSpec[]; options: RequestOptions }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), ...toWireMessages(input.messages)],
  };
  if (input.tools.length > 0) body['tools'] = input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const o = input.options;
  if (o.temperature !== undefined) body['temperature'] = o.temperature;
  if (o.topP !== undefined) body['top_p'] = o.topP;
  if (o.maxOutputTokens !== undefined) body['max_tokens'] = o.maxOutputTokens;
  return body;
}

export function toWireMessages(messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'toolResult') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.text });
    else {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: 'toolCall' }> => b.type === 'toolCall');
      const msg: Record<string, unknown> = { role: 'assistant', content: text || (calls.length > 0 ? null : '') };
      if (calls.length > 0) msg['tool_calls'] = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.raw ?? JSON.stringify(c.args ?? {}) } }));
      out.push(msg);
    }
  }
  return out;
}

export interface AssembledCall { id: string; name: string; argsText: string }
export interface StepResult {
  text: string; thinking: string; calls: AssembledCall[]; finishReason: string | null; usage: Usage | null; model: string | null;
  error: { message: string; code?: string; type?: string } | null;
}
export interface ReducerHandlers {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
  /** `callId` is the id the finished `tool.call` will carry. */
  onToolInput?(callId: string, delta: string): void;
}
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

interface Slot { id: string; providerId: boolean; name: string; args: string }

/**
 * Folds parsed stream chunks into one step. Every rule here is written from a real provider's
 * bytes: ids repeated on every chunk or sent once, the name resent, whole arguments in one delta,
 * `finish_reason` on two chunks, reasoning under three field names, usage on the last content
 * chunk or on a separate `choices: []` chunk. `finish_reason` never decides whether tools ran.
 */
export class StreamReducer {
  private text = '';
  private thinking = '';
  private slots: Slot[] = [];
  private byIndex = new Map<number, Slot>();
  private finish: string | null = null;
  private usage: Usage | null = null;
  private model: string | null = null;
  private error: StepResult['error'] = null;
  private seq = 0;

  constructor(private handlers: ReducerHandlers = {}, private idPrefix = 'call') {}

  push(chunk: unknown): void {
    if (!isObj(chunk)) return;
    if (isObj(chunk['error'])) {
      const e = chunk['error'];
      this.error = { message: String(e['message'] ?? 'provider error'), ...(e['code'] != null ? { code: String(e['code']) } : {}), ...(typeof e['type'] === 'string' ? { type: e['type'] } : {}) };
    }
    if (typeof chunk['model'] === 'string' && chunk['model']) this.model = chunk['model'];
    if (isObj(chunk['usage'])) this.usage = readUsage(chunk['usage']);
    const choice = Array.isArray(chunk['choices']) ? chunk['choices'][0] : undefined;
    if (!isObj(choice)) return;
    if (typeof choice['finish_reason'] === 'string') this.finish = choice['finish_reason'];
    const delta = choice['delta'];
    if (!isObj(delta)) return;
    if (typeof delta['content'] === 'string' && delta['content']) { this.text += delta['content']; this.handlers.onText?.(delta['content']); }
    const think = reasoningOf(delta);
    if (think) { this.thinking += think; this.handlers.onThinking?.(think); }
    if (Array.isArray(delta['tool_calls'])) for (const tc of delta['tool_calls']) if (isObj(tc)) this.toolDelta(tc);
  }

  private toolDelta(tc: Json): void {
    const index = num(tc['index']) ?? 0;
    const id = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : null;
    let slot = this.byIndex.get(index);
    // A different non-empty id at an index already holding one opens a new call: some proxies send index 0 for parallel calls.
    if (slot && id && slot.providerId && slot.id !== id) slot = undefined;
    if (!slot) {
      slot = { id: id ?? `${this.idPrefix}_${++this.seq}`, providerId: id !== null, name: '', args: '' };
      this.slots.push(slot);
      this.byIndex.set(index, slot);
    } else if (id && !slot.providerId) { slot.id = id; slot.providerId = true; }
    const fn = isObj(tc['function']) ? tc['function'] : {};
    if (typeof fn['name'] === 'string' && fn['name'] && !slot.name) slot.name = fn['name'];
    const args = fn['arguments'];
    if (typeof args === 'string' && args) { slot.args += args; this.handlers.onToolInput?.(slot.id, args); }
    else if (isObj(args)) { const s = JSON.stringify(args); slot.args = s; this.handlers.onToolInput?.(slot.id, s); }
  }

  result(): StepResult {
    return { text: this.text, thinking: this.thinking, calls: this.slots.filter((s) => s.name).map((s) => ({ id: s.id, name: s.name, argsText: s.args.trim() === '' ? '{}' : s.args })), finishReason: this.finish, usage: this.usage, model: this.model, error: this.error };
  }
}

function reasoningOf(delta: Json): string {
  for (const k of ['reasoning_content', 'reasoning']) if (typeof delta[k] === 'string' && delta[k]) return delta[k] as string;
  const details = delta['reasoning_details'];
  if (Array.isArray(details)) return details.map((d) => (isObj(d) && typeof d['text'] === 'string' ? d['text'] : '')).join('');
  return '';
}

function readUsage(u: Json): Usage {
  const pd = isObj(u['prompt_tokens_details']) ? u['prompt_tokens_details'] : {};
  const cd = isObj(u['completion_tokens_details']) ? u['completion_tokens_details'] : {};
  return {
    promptTokens: num(u['prompt_tokens']) ?? 0, completionTokens: num(u['completion_tokens']) ?? 0,
    cachedTokens: num(pd['cached_tokens']) ?? num(u['prompt_cache_hit_tokens']) ?? 0, reasoningTokens: num(cd['reasoning_tokens']) ?? 0, estimated: false,
  };
}

/** Parse tool-call arguments; a failure is a value, not an exception, so the loop can hand the model a corrective result. */
export function parseArgs(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Classify an HTTP failure. A 402 is quota, not a bad request. */
export function classifyHttp(status: number, body: string, retryAfterMs?: number): AgentError {
  let message = body.slice(0, 500);
  let code: string | undefined;
  try { const j = JSON.parse(body) as Json; const e = isObj(j['error']) ? j['error'] : j; message = String(e['message'] ?? message); code = e['code'] != null ? String(e['code']) : undefined; } catch { /* not JSON */ }
  const lower = `${message} ${code ?? ''}`.toLowerCase();
  const withRetry = retryAfterMs !== undefined ? { retryAfterMs } : {};
  if (status === 402 || /insufficient[_ ](quota|balance)|billing|quota/.test(lower) && (status === 429 || status === 403)) return { code: 'quota_exhausted', family: 'provider_quota', message, status, ...withRetry };
  if (status === 401 || status === 403) return { code: 'auth_failed', family: 'auth', message, status };
  if (status === 429) return { code: 'rate_limited', family: 'transient_upstream', message, status, ...withRetry };
  if (status === 408 || status === 409 || status >= 500) return { code: 'upstream_error', family: 'transient_upstream', message, status, ...withRetry };
  if (status === 400 && /context|maximum.*length|too many tokens|token limit/.test(lower)) return { code: 'context_overflow', family: 'resource', message, status };
  if (status === 404) return { code: 'model_not_found', family: 'tooling', message, status };
  if (status === 400 || status === 422) return { code: 'invalid_request', family: 'tooling', message, status };
  return { code: 'unknown', family: 'unknown', message, status };
}
