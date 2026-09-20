import type { ProviderCompat, ProviderProfile } from '@weave-ai/shared';
import { buildRequest, classifyHttp, StreamReducer } from './codec/chatCompletions.js';
import { completeCompat } from './codec/params.js';
import { inspectCapture } from './conformance.js';
import { chatCompletionsUrl, requestHeaders } from './profile.js';
import { headersWithExtras, loadPreset, resolveProvider } from './resolve.js';
import { SseParser } from './sse.js';

export interface ProbeCheck { name: string; ok: boolean; detail: string }
export interface ProbeReport {
  ok: boolean;
  checks: ProbeCheck[];
  /** Flags the probes measured, in the shape of a profile's `compat`: what "apply detected flags" writes. Only fields a probe actually decided. */
  detected: ProviderCompat;
}
export interface ProbeOptions {
  profile: ProviderProfile;
  /** The model id as the provider knows it (no `providerId/` prefix). */
  model: string;
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  /** Called with each raw response body, so a harness can keep the bytes. */
  onCapture?: (name: string, body: Buffer) => void;
  timeoutMs?: number;
}

const TOOL = { name: 'get_time', description: 'Get the current time in a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };

/**
 * The cheap conformance probes behind `POST /providers/:id/test` and the `--probe` CLI flag: five
 * small requests, no repository, no agent loop. Every one is user-initiated; nothing calls this on a
 * schedule. A failed probe is a check that says so, never an exception.
 */
export async function probeProvider(o: ProbeOptions): Promise<ProbeReport> {
  const f = o.fetch ?? fetch;
  const preset = loadPreset(o.profile.preset ?? 'openai-compatible');
  const model = o.profile.models[o.model];
  const resolved = resolveProvider({ preset, profile: o.profile, model });
  const extra = headersWithExtras(o.profile.headers, resolved.params.extraHeaders);
  const provider = { id: 'probe', baseUrl: o.profile.baseUrl, auth: o.profile.auth, headers: extra.headers, ...(o.apiKey ? { apiKey: o.apiKey } : {}) };
  const headers = requestHeaders(provider);
  const checks: ProbeCheck[] = [];
  const detected: ProviderCompat = {};
  const timeoutMs = o.timeoutMs ?? 60_000;

  const send = async (name: string, url: string, init: RequestInit): Promise<{ status: number; body: Buffer } | { error: string }> => {
    try {
      const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const body = Buffer.from(await res.arrayBuffer());
      o.onCapture?.(name, body);
      return { status: res.status, body };
    } catch (e) { return { error: (e as Error).message }; }
  };
  const failure = (r: { status: number; body: Buffer }): string => { const e = classifyHttp(r.status, r.body.toString('utf8')); return `${r.status} ${e.code} (${e.family}): ${e.message.slice(0, 200)}`; };
  const base = o.profile.baseUrl.replace(/\/+$/, '');
  const compat = resolved.compat;
  const modelsPath = compat.modelsPath;

  // 1. models list
  {
    const r = await send('models', `${base}${modelsPath}${o.profile.query ? `?${new URLSearchParams(o.profile.query)}` : ''}`, { headers: { ...headers, accept: 'application/json' } });
    if ('error' in r) checks.push({ name: 'models list', ok: false, detail: r.error });
    else if (r.status !== 200) checks.push({ name: 'models list', ok: false, detail: failure(r) });
    else {
      let count = 0;
      try { const j = JSON.parse(r.body.toString('utf8')) as { data?: unknown[] }; count = Array.isArray(j.data) ? j.data.length : 0; } catch { /* not JSON */ }
      checks.push({ name: 'models list', ok: count > 0, detail: `${count} model(s) at ${modelsPath}` });
    }
  }

  const stream = async (name: string, tools: boolean, prompt: string): Promise<{ text: string; calls: number; usage: string; reasoning: string[]; model: string | null; bytes: Buffer } | string> => {
    const warnings: string[] = [];
    const body = buildRequest({ model: o.model, system: '', messages: [{ role: 'user', text: prompt }], tools: tools ? [TOOL] : [], options: { ...resolved.params, maxOutputTokens: resolved.params.maxOutputTokens ?? 512 }, compat: completeCompat(resolved.compat), warnings });
    const r = await send(name, chatCompletionsUrl(o.profile.baseUrl, o.profile.query), { method: 'POST', headers, body: JSON.stringify(body) });
    if ('error' in r) return r.error;
    if (r.status !== 200) return failure(r);
    const parser = new SseParser(); const red = new StreamReducer({}, 'probe', { reasoningField: compat.reasoning.field });
    for (const e of [...parser.feed(new Uint8Array(r.body)), ...parser.end()]) { if (e.data === '[DONE]') continue; try { red.push(JSON.parse(e.data)); } catch { /* ignore */ } }
    const res = red.result();
    if (res.error) return `error in stream: ${res.error.message}`;
    const facts = inspectCapture(r.body);
    return { text: res.text, calls: res.calls.length, usage: facts.usage, reasoning: facts.reasoningFields, model: res.model, bytes: r.body };
  };

  // 2. plain streamed answer: streaming works, usage shape, thinking field, the model the provider reports
  const chat = await stream('chat', false, 'Reply with the single word OK.');
  if (typeof chat === 'string') checks.push({ name: 'streamed answer', ok: false, detail: chat });
  else {
    checks.push({ name: 'streamed answer', ok: chat.text.length > 0 || chat.reasoning.length > 0, detail: `${chat.text.slice(0, 60) || '(no text)'}; served by ${chat.model ?? 'unknown'}` });
    checks.push({ name: 'usage reported', ok: chat.usage !== 'none', detail: chat.usage === 'none' ? 'no usage in the stream (the agent will estimate)' : `usage on ${chat.usage === 'with_finish' ? 'the finish chunk' : 'a separate empty-choices chunk'}` });
    if (chat.usage === 'none') detected.streamUsage = 'stream_options';
    if (chat.reasoning.length > 0) {
      detected.reasoning = { field: chat.reasoning.includes('reasoning_content') ? 'reasoning_content' : chat.reasoning.includes('reasoning') ? 'reasoning' : 'reasoning_details' };
      checks.push({ name: 'thinking field', ok: true, detail: chat.reasoning.join(', ') });
    }
  }

  // 3. a tool call assembles
  const tool = await stream('tools', true, 'What time is it in Paris? Use the get_time tool.');
  if (typeof tool === 'string') { checks.push({ name: 'tool call', ok: false, detail: tool }); detected.tools = { supported: false }; }
  else checks.push({ name: 'tool call', ok: tool.calls > 0, detail: tool.calls > 0 ? `${tool.calls} call(s) assembled` : 'the model made no tool call' });

  // 4. which spelling of the output cap the endpoint honours: ask for 16 tokens both ways
  const honoured: Record<string, boolean | string> = {};
  for (const param of ['max_tokens', 'max_completion_tokens'] as const) {
    const body = { model: o.model, messages: [{ role: 'user', content: 'Count from 1 to 40, one number per line.' }], [param]: 16 };
    const r = await send(`cap-${param}`, chatCompletionsUrl(o.profile.baseUrl, o.profile.query), { method: 'POST', headers: { ...headers, accept: 'application/json' }, body: JSON.stringify(body) });
    if ('error' in r) { honoured[param] = r.error; continue; }
    if (r.status !== 200) { honoured[param] = failure(r); continue; }
    try { const j = JSON.parse(r.body.toString('utf8')) as { usage?: { completion_tokens?: number }; choices?: Array<{ finish_reason?: string }> }; honoured[param] = j.choices?.[0]?.finish_reason === 'length' || (j.usage?.completion_tokens ?? 99) <= 16; }
    catch { honoured[param] = 'response was not JSON'; }
  }
  const ok = (k: string): boolean => honoured[k] === true;
  checks.push({ name: 'output cap', ok: ok('max_tokens') || ok('max_completion_tokens'), detail: `max_tokens ${label(honoured['max_tokens'])}; max_completion_tokens ${label(honoured['max_completion_tokens'])}` });
  if (ok(compat.maxTokensParam)) { /* the current spelling works: leave it */ }
  else if (ok('max_tokens')) detected.maxTokensParam = 'max_tokens';
  else if (ok('max_completion_tokens')) detected.maxTokensParam = 'max_completion_tokens';

  for (const e of extra.errors) checks.push({ name: 'profile', ok: false, detail: e });
  return { ok: checks.every((c) => c.ok), checks, detected };
}

const label = (v: boolean | string | undefined): string => (v === true ? 'honoured' : v === false ? 'ignored' : v ?? 'not tried');
