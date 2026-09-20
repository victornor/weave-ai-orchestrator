import { createHash } from 'node:crypto';
import type { ProviderCompat, ProviderParams } from '@weave-ai/shared';
import type { ContentBlock, ImagePart, Message } from '../types.js';

export type Params = ProviderParams & { contextWindowTokens?: number };

export type ImageInput = 'none' | 'user' | 'user_and_tool';

/** Every flag with its value when nothing sets it. `max_tokens` is what the probed endpoints all honoured. */
export interface Compat {
  maxTokensParam: 'max_completion_tokens' | 'max_tokens';
  streamUsage: 'stream_options' | 'always' | 'never';
  systemRole: 'system' | 'developer';
  omitParams: string[];
  reasoning: { field: 'auto' | 'reasoning_content' | 'reasoning' | 'reasoning_details' | 'think_tags' | 'none'; passBack: 'none' | 'reasoning_content' | 'all'; effortParam: 'reasoning_effort' | 'reasoning.effort' | 'none'; effortMap: Record<string, string>; effortLevels: string[] };
  tools: { supported: boolean; parallel: boolean; choice: Array<'auto' | 'required' | 'none' | 'named'>; strict: boolean; idFormat: 'any' | 'alnum9' | 'safe64' };
  strictAlternation: boolean;
  emptyContent: 'null' | 'empty';
  image: { input: ImageInput };
  responseFormat: Array<'json_object' | 'json_schema'>;
  seedParam: string;
  stopMax: number | undefined;
  modelsPath: string;
  contextField: string | undefined;
  promptCache: 'none' | 'key' | 'anthropic';
  cachedTokensField: string | undefined;
}

export const DEFAULT_COMPAT: Compat = {
  maxTokensParam: 'max_tokens', streamUsage: 'stream_options', systemRole: 'system', omitParams: [],
  reasoning: { field: 'auto', passBack: 'none', effortParam: 'none', effortMap: {}, effortLevels: [] },
  tools: { supported: true, parallel: true, choice: ['auto', 'required', 'none'], strict: false, idFormat: 'any' },
  strictAlternation: false, emptyContent: 'null', image: { input: 'user' }, responseFormat: ['json_object'], seedParam: 'seed', stopMax: undefined, modelsPath: '/models', contextField: undefined, promptCache: 'none', cachedTokensField: undefined,
};

/** Fill the defaults under a (possibly partial) compat block. */
export function completeCompat(c: ProviderCompat | undefined): Compat {
  const d = DEFAULT_COMPAT;
  const r = c?.reasoning; const t = c?.tools;
  return {
    maxTokensParam: c?.maxTokensParam ?? d.maxTokensParam, streamUsage: c?.streamUsage ?? d.streamUsage, systemRole: c?.systemRole ?? d.systemRole,
    omitParams: c?.omitParams ?? d.omitParams,
    reasoning: { field: r?.field ?? d.reasoning.field, passBack: r?.passBack ?? d.reasoning.passBack, effortParam: r?.effortParam ?? d.reasoning.effortParam, effortMap: r?.effortMap ?? d.reasoning.effortMap, effortLevels: r?.effortLevels ?? d.reasoning.effortLevels },
    tools: { supported: t?.supported ?? d.tools.supported, parallel: t?.parallel ?? d.tools.parallel, choice: t?.choice ?? d.tools.choice, strict: t?.strict ?? d.tools.strict, idFormat: t?.idFormat ?? d.tools.idFormat },
    strictAlternation: c?.strictAlternation ?? d.strictAlternation, emptyContent: c?.emptyContent ?? d.emptyContent,
    image: { input: c?.image?.input ?? d.image.input },
    responseFormat: c?.responseFormat ?? d.responseFormat, seedParam: c?.seedParam ?? d.seedParam, stopMax: c?.stopMax, modelsPath: c?.modelsPath ?? d.modelsPath, contextField: c?.contextField, promptCache: c?.promptCache ?? d.promptCache, cachedTokensField: c?.cachedTokensField,
  };
}

/** The option keys as they are spelled on the wire, so `omitParams` may use either spelling. */
const WIRE_OF: Record<string, string> = {
  topP: 'top_p', frequencyPenalty: 'frequency_penalty', presencePenalty: 'presence_penalty', maxOutputTokens: 'max_tokens', toolChoice: 'tool_choice',
  parallelToolCalls: 'parallel_tool_calls', responseFormat: 'response_format', extraBody: 'extra_body',
};
const wire = (k: string): string => WIRE_OF[k] ?? k;

export interface ParamsOutcome { warnings: string[] }

/**
 * Write the parameters onto `body`. Only what a layer set is written; `omitParams` strips last, so
 * not even `extraBody` can bring an omitted key back. Values a flag says the endpoint cannot take are
 * dropped with a warning naming the flag instead of being sent to fail.
 */
export function applyParams(body: Record<string, unknown>, params: Params, compat: Compat, effort: string | null | undefined, hasTools: boolean): ParamsOutcome {
  const warnings: string[] = [];
  if (params.temperature !== undefined) body['temperature'] = params.temperature;
  if (params.topP !== undefined) body['top_p'] = params.topP;
  if (params.frequencyPenalty !== undefined) body['frequency_penalty'] = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) body['presence_penalty'] = params.presencePenalty;
  if (params.maxOutputTokens !== undefined) body[compat.maxTokensParam] = Math.floor(params.maxOutputTokens);
  if (params.seed !== undefined) body[compat.seedParam] = params.seed;
  if (params.stop !== undefined && params.stop.length > 0) {
    const stop = compat.stopMax !== undefined ? params.stop.slice(0, compat.stopMax) : params.stop;
    if (stop.length < params.stop.length) warnings.push(`stop lists ${params.stop.length} sequences; this endpoint takes ${compat.stopMax} (compat.stopMax), the rest were dropped`);
    body['stop'] = stop;
  }
  if (params.toolChoice !== undefined && hasTools) {
    if (compat.tools.choice.includes(params.toolChoice)) body['tool_choice'] = params.toolChoice;
    else warnings.push(`toolChoice ${params.toolChoice} is not in compat.tools.choice; not sent`);
  }
  if (params.parallelToolCalls !== undefined && hasTools) {
    if (compat.tools.parallel) body['parallel_tool_calls'] = params.parallelToolCalls;
    else warnings.push('parallelToolCalls is set but compat.tools.parallel is false; not sent');
  }
  if (params.responseFormat === 'json_object') {
    if (compat.responseFormat.includes('json_object')) body['response_format'] = { type: 'json_object' };
    else warnings.push('responseFormat json_object is not in compat.responseFormat; not sent');
  }
  if (effort && compat.reasoning.effortParam !== 'none') {
    const value = compat.reasoning.effortMap[effort] ?? effort;
    if (compat.reasoning.effortParam === 'reasoning_effort') body['reasoning_effort'] = value;
    else body['reasoning'] = { ...(typeof body['reasoning'] === 'object' && body['reasoning'] ? body['reasoning'] as object : {}), effort: value };
  }
  if (params.extraBody !== undefined && params.extraBody.trim() !== '') {
    try {
      const extra: unknown = JSON.parse(params.extraBody);
      if (typeof extra === 'object' && extra !== null && !Array.isArray(extra)) Object.assign(body, extra);
      else warnings.push('extraBody is not a JSON object; ignored');
    } catch (e) { warnings.push(`extraBody is not valid JSON (${(e as Error).message}); ignored`); }
  }
  for (const k of compat.omitParams) delete body[wire(k)];
  return { warnings };
}

/** Parse `Name: value` lines. A line without a colon is reported, not guessed at. */
export function parseExtraHeaders(lines: string[] | undefined): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {}; const errors: string[] = [];
  for (const line of lines ?? []) {
    const i = line.indexOf(':');
    if (i <= 0) { errors.push(`extraHeaders entry "${line}" is not "Name: value"`); continue; }
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { headers, errors };
}

/** Wire ids for the tool calls of one request, honouring `idFormat`. Both the call and its result map the same internal id to the same wire id. */
export function wireIdMap(messages: Message[], format: Compat['tools']['idFormat']): Map<string, string> {
  const map = new Map<string, string>();
  if (format === 'any') return map;
  const taken = new Set<string>();
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') ids.push(b.id);
  }
  for (const id of ids) {
    if (map.has(id)) continue;
    let w: string;
    if (format === 'safe64') { w = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64); for (let n = 2; taken.has(w); n++) w = `${w.slice(0, 60)}_${n}`; }
    else { for (let n = 0; ; n++) { w = createHash('sha256').update(`${id}:${n}`).digest('hex').slice(0, 9); if (!taken.has(w)) break; } }
    taken.add(w); map.set(id, w);
  }
  return map;
}

/** Index of the first message of the current turn: the last user message (a prompt or steering line). */
export const currentTurnStart = (messages: Message[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i;
  return 0;
};

export function toWireMessages(messages: Message[], compat: Compat = DEFAULT_COMPAT): Array<Record<string, unknown>> {
  const ids = wireIdMap(messages, compat.tools.idFormat);
  const id = (i: string): string => ids.get(i) ?? i;
  const turn = currentTurnStart(messages);
  const out: Array<Record<string, unknown>> = [];
  messages.forEach((m, index) => {
    if (m.role === 'user') {
      if (compat.strictAlternation && out[out.length - 1]?.['role'] === 'tool') out.push({ role: 'assistant', content: '' });
      const images = compat.image.input === 'none' ? [] : (m.images ?? []);
      out.push({ role: 'user', content: images.length > 0 ? partsContent(m.text, images) : m.text });
    } else if (m.role === 'toolResult') {
      const images = compat.image.input === 'user_and_tool' ? (m.images ?? []) : [];
      out.push({ role: 'tool', tool_call_id: id(m.toolCallId), content: images.length > 0 ? partsContent(m.text, images) : m.text });
    } else {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: 'toolCall' }> => b.type === 'toolCall');
      const msg: Record<string, unknown> = { role: 'assistant', content: text || (calls.length > 0 && compat.emptyContent === 'null' ? null : '') };
      if (calls.length > 0) msg['tool_calls'] = calls.map((c) => ({ id: id(c.id), type: 'function', function: { name: c.name, arguments: c.raw ?? JSON.stringify(c.args ?? {}) } }));
      const pb = compat.reasoning.passBack;
      if (pb !== 'none' && (pb === 'all' || (index >= turn && calls.length > 0))) {
        const thinking = m.content.filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking').map((b) => b.text).join('');
        if (thinking) msg['reasoning_content'] = thinking;
      }
      out.push(msg);
    }
  });
  return out;
}

/** A text part plus one OpenAI `image_url` data part per image, in order. */
function partsContent(text: string, images: ImagePart[]): unknown[] {
  const parts: unknown[] = [];
  if (text) parts.push({ type: 'text', text });
  for (const p of images) parts.push({ type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } });
  return parts;
}

/** Splits `<think>…</think>` out of streamed content, across chunk boundaries. */
export class ThinkTagSplitter {
  private inside = false;
  private held = '';
  push(delta: string): { text: string; thinking: string } {
    let text = ''; let thinking = '';
    let s = this.held + delta; this.held = '';
    for (;;) {
      const tag = this.inside ? '</think>' : '<think>';
      const at = s.indexOf(tag);
      if (at >= 0) { (this.inside ? (thinking += s.slice(0, at)) : (text += s.slice(0, at))); s = s.slice(at + tag.length); this.inside = !this.inside; continue; }
      // Hold back a tail that could be the start of the tag.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) { keep = n; break; }
      this.held = s.slice(s.length - keep);
      const rest = s.slice(0, s.length - keep);
      if (this.inside) thinking += rest; else text += rest;
      return { text, thinking };
    }
  }
  flush(): { text: string; thinking: string } { const h = this.held; this.held = ''; return this.inside ? { text: '', thinking: h } : { text: h, thinking: '' }; }
}
