import type { InitMessage } from './protocol.js';
import type { RequestOptions } from './codec/chatCompletions.js';
import { agentUserAgent } from './version.js';

/** The parameters a run's own options carry, for an init that arrives without resolved `params`. The adapter always resolves; this is the fallback. */
export function requestOptions(options: Record<string, unknown>): RequestOptions {
  const out: RequestOptions = {};
  const n = (k: string): number | undefined => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? (options[k] as number) : undefined);
  const t = n('temperature'); if (t !== undefined) out.temperature = t;
  const p = n('topP'); if (p !== undefined) out.topP = p;
  const m = n('maxOutputTokens'); if (m !== undefined) out.maxOutputTokens = Math.floor(m);
  const c = n('contextWindowTokens'); if (c !== undefined) out.contextWindowTokens = Math.floor(c);
  return out;
}

/**
 * Request headers for a provider. A default `User-Agent` names this product so an endpoint behind a bot
 * challenge does not answer an HTML page; a profile header naming `user-agent` in any case replaces it
 * (headers are case-insensitive, so exactly one is ever sent). The key goes in the header its `auth`
 * names, and nowhere else.
 */
export function requestHeaders(provider: InitMessage['provider']): Record<string, string> {
  const profileHeaders = provider.headers ?? {};
  const hasUserAgent = Object.keys(profileHeaders).some((k) => /^user-agent$/i.test(k));
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream', ...(hasUserAgent ? {} : { 'user-agent': agentUserAgent() }), ...profileHeaders };
  if (provider.apiKey) {
    if (provider.auth === 'bearer') h['authorization'] = `Bearer ${provider.apiKey}`;
    else if (provider.auth.startsWith('header:')) h[provider.auth.slice('header:'.length)] = provider.apiKey;
  }
  return h;
}

export function chatCompletionsUrl(baseUrl: string, query?: Record<string, string>): string {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const qs = new URLSearchParams(query ?? {}).toString();
  return qs ? `${url}?${qs}` : url;
}

/** The environment a shell tool gets: the adapter's tool env plus a minimal base. A variable holding the key is dropped even if one slipped in. */
export function shellEnv(toolEnv: Record<string, string>, apiKey: string | undefined): Record<string, string> {
  const env: Record<string, string> = { LANG: 'C.UTF-8', TERM: 'dumb', ...toolEnv };
  if (apiKey) for (const [k, v] of Object.entries(env)) if (v.includes(apiKey)) delete env[k];
  return env;
}
