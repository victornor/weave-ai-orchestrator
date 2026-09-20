import type { Message, Usage } from '../types.js';
import { applyParams, DEFAULT_COMPAT, ThinkTagSplitter, toWireMessages, type Compat, type Params } from './params.js';

export { toWireMessages };
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export type RequestOptions = Params;

/**
 * The request body for one step. Only parameters a layer set are present: a value nobody chose is
 * not sent, so the provider's own default applies. Names and shapes follow the resolved `compat`
 * flags; the defaults are the ones every probed endpoint honoured.
 */
export function buildRequest(input: { model: string; system: string; messages: Message[]; tools: ToolSpec[]; options: RequestOptions; compat?: Compat; effort?: string | null; warnings?: string[]; /** The session id: with `promptCache` it names the cached prefix. Absent for one-off requests such as a summary, which are never cached. */ cacheKey?: string }): Record<string, unknown> {
  const compat = input.compat ?? DEFAULT_COMPAT;
  const tools = compat.tools.supported ? input.tools : [];
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    messages: [...(input.system ? [{ role: compat.systemRole, content: input.system }] : []), ...toWireMessages(input.messages, compat)],
  };
  if (compat.streamUsage === 'stream_options') body['stream_options'] = { include_usage: true };
  if (tools.length > 0) body['tools'] = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, ...(compat.tools.strict ? { strict: true } : {}) } }));
  if (input.cacheKey) applyPromptCache(body, compat, input.cacheKey);
  const { warnings } = applyParams(body, input.options, compat, input.effort, tools.length > 0);
  input.warnings?.push(...warnings);
  return body;
}

/**
 * `key`: `prompt_cache_key` names the prefix. `anthropic`: `cache_control` markers on the system message, the last tool
 * and the last user message, the three places a Claude-compatible gateway reads them. Both leave the message order alone.
 */
function applyPromptCache(body: Record<string, unknown>, compat: Compat, key: string): void {
  if (compat.promptCache === 'key') { body['prompt_cache_key'] = key; return; }
  if (compat.promptCache !== 'anthropic') return;
  const mark = { type: 'ephemeral' };
  const withMarker = (content: unknown): unknown => (typeof content === 'string' ? [{ type: 'text', text: content, cache_control: mark }] : content);
  const messages = body['messages'] as Array<Record<string, unknown>>;
  const sys = messages.find((m) => m['role'] === compat.systemRole);
  if (sys) sys['content'] = withMarker(sys['content']);
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!['role'] === 'user') { messages[i]!['content'] = withMarker(messages[i]!['content']); break; }
  const tools = body['tools'] as Array<Record<string, unknown>> | undefined;
  if (tools && tools.length > 0) tools[tools.length - 1]!['cache_control'] = mark;
}

export interface AssembledCall { id: string; name: string; argsText: string }
export interface StepResult {
  text: string; thinking: string; calls: AssembledCall[]; finishReason: string | null; refusal?: string; usage: Usage | null; model: string | null;
  error: { message: string; code?: string; type?: string } | null;
}
export interface ReducerOptions { reasoningField?: Compat['reasoning']['field']; cachedTokensField?: string | undefined }
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
  private refusal = '';
  private seq = 0;

  private splitter: ThinkTagSplitter | null;
  constructor(private handlers: ReducerHandlers = {}, private idPrefix = 'call', private opts: ReducerOptions = {}) { this.splitter = opts.reasoningField === 'think_tags' ? new ThinkTagSplitter() : null; }

  private addText(t: string): void { if (t) { this.text += t; this.handlers.onText?.(t); } }
  private addThinking(t: string): void { if (t) { this.thinking += t; this.handlers.onThinking?.(t); } }

  push(chunk: unknown): void {
    if (!isObj(chunk)) return;
    if (isObj(chunk['error'])) {
      const e = chunk['error'];
      this.error = { message: String(e['message'] ?? 'provider error'), ...(e['code'] != null ? { code: String(e['code']) } : {}), ...(typeof e['type'] === 'string' ? { type: e['type'] } : {}) };
    }
    if (typeof chunk['model'] === 'string' && chunk['model']) this.model = chunk['model'];
    if (isObj(chunk['usage'])) this.usage = readUsage(chunk['usage'], this.opts.cachedTokensField);
    const choice = Array.isArray(chunk['choices']) ? chunk['choices'][0] : undefined;
    if (!isObj(choice)) return;
    if (typeof choice['finish_reason'] === 'string') this.finish = choice['finish_reason'];
    const delta = choice['delta'];
    if (!isObj(delta)) return;
    if (typeof delta['content'] === 'string' && delta['content']) {
      if (this.splitter) { const r = this.splitter.push(delta['content']); this.addText(r.text); this.addThinking(r.thinking); } else this.addText(delta['content']);
    }
    if (typeof delta['refusal'] === 'string') this.refusal += delta['refusal'];
    this.addThinking(reasoningOf(delta, this.opts.reasoningField ?? 'auto'));
    if (Array.isArray(delta['tool_calls'])) for (const tc of delta['tool_calls']) if (isObj(tc)) this.toolDelta(tc);
  }

  private toolDelta(tc: Json): void {
    const index = num(tc['index']) ?? 0;
    const id = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : null;
    let slot = this.byIndex.get(index);
    // A different non-empty id at an index already holding one opens a new call: some proxies send index 0 for parallel calls.
    if (slot && id && slot.providerId && slot.id !== id) slot = undefined;
    // A different function name at an index that already has one is a second call that reused the index without an id.
    const newName = isObj(tc['function']) && typeof tc['function']['name'] === 'string' ? tc['function']['name'] : '';
    if (slot && newName && slot.name && newName !== slot.name) slot = undefined;
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
    if (this.splitter) { const r = this.splitter.flush(); this.addText(r.text); this.addThinking(r.thinking); }
    return { text: this.text, thinking: this.thinking, calls: this.slots.filter((s) => s.name).map((s) => ({ id: s.id, name: s.name, argsText: s.args.trim() === '' ? '{}' : s.args })), finishReason: this.finish, ...(this.refusal ? { refusal: this.refusal } : {}), usage: this.usage, model: this.model, error: this.error };
  }
}

/** Where thinking arrives. `auto` accepts the three spellings seen on real endpoints, first non-empty wins; a named field reads only that one. */
function reasoningOf(delta: Json, field: NonNullable<ReducerOptions['reasoningField']>): string {
  if (field === 'none' || field === 'think_tags') return '';
  for (const k of ['reasoning_content', 'reasoning']) if ((field === 'auto' || field === k) && typeof delta[k] === 'string' && delta[k]) return delta[k] as string;
  const details = delta['reasoning_details'];
  if ((field === 'auto' || field === 'reasoning_details') && Array.isArray(details)) return details.map((d) => (isObj(d) && typeof d['text'] === 'string' ? d['text'] : '')).join('');
  return '';
}

function readUsage(u: Json, cachedField?: string): Usage {
  const pd = isObj(u['prompt_tokens_details']) ? u['prompt_tokens_details'] : {};
  const cd = isObj(u['completion_tokens_details']) ? u['completion_tokens_details'] : {};
  return {
    promptTokens: num(u['prompt_tokens']) ?? 0, completionTokens: num(u['completion_tokens']) ?? 0,
    cachedTokens: (cachedField ? num(dotted(u, cachedField)) : undefined) ?? num(pd['cached_tokens']) ?? num(u['prompt_cache_hit_tokens']) ?? 0, reasoningTokens: num(cd['reasoning_tokens']) ?? 0, estimated: false,
  };
}

const dotted = (o: Json, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);

export { classifyHttp } from '../errors.js';
