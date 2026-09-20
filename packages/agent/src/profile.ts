import type { InitMessage } from './protocol.js';
import type { RequestOptions } from './codec/chatCompletions.js';

/** The four option keys this slice honours. Anything else is ignored here and rejected by the adapter's configSchema. */
export function requestOptions(options: Record<string, unknown>): RequestOptions {
  const out: RequestOptions = {};
  const n = (k: string): number | undefined => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? (options[k] as number) : undefined);
  const t = n('temperature'); if (t !== undefined) out.temperature = t;
  const p = n('topP'); if (p !== undefined) out.topP = p;
  const m = n('maxOutputTokens'); if (m !== undefined) out.maxOutputTokens = Math.floor(m);
  const c = n('contextWindowTokens'); if (c !== undefined) out.contextWindowTokens = Math.floor(c);
  return out;
}

/** Request headers for a provider. The key goes in the header its `auth` names, and nowhere else. */
export function requestHeaders(provider: InitMessage['provider']): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream', ...provider.headers };
  if (provider.apiKey) {
    if (provider.auth === 'bearer') h['authorization'] = `Bearer ${provider.apiKey}`;
    else if (provider.auth.startsWith('header:')) h[provider.auth.slice('header:'.length)] = provider.apiKey;
  }
  return h;
}

export const chatCompletionsUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

/** The environment a shell tool gets: the adapter's tool env plus a minimal base. A variable holding the key is dropped even if one slipped in. */
export function shellEnv(toolEnv: Record<string, string>, apiKey: string | undefined): Record<string, string> {
  const env: Record<string, string> = { LANG: 'C.UTF-8', TERM: 'dumb', ...toolEnv };
  if (apiKey) for (const [k, v] of Object.entries(env)) if (v.includes(apiKey)) delete env[k];
  return env;
}
