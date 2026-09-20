import type { ProviderProfile } from '@weave-ai/shared';
import { requestHeaders } from './profile.js';
import { headersWithExtras, loadPreset, resolveProvider } from './resolve.js';

/** One model the endpoint reports, with its context window when the endpoint names one. */
export interface ProviderModel { id: string; contextWindow?: number }
export interface ProviderModelsResult { ok: boolean; models: ProviderModel[]; error?: string }
export interface ListProviderModelsOptions {
  profile: ProviderProfile;
  /** Used only for this request; never stored or logged. */
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * VS-635: `GET {baseUrl}{modelsPath}` for a provider, through the same preset/compat resolution the
 * run path uses, so the Settings "fetch from endpoint" action and the runtime's own discovery agree.
 * Pure I/O: never throws, and a failure is a one-line reason with `ok: false`.
 */
export async function listProviderModels(o: ListProviderModelsOptions): Promise<ProviderModelsResult> {
  const f = o.fetch ?? fetch;
  try {
    const preset = loadPreset(o.profile.preset ?? 'openai-compatible');
    const { compat, params } = resolveProvider({ preset, profile: o.profile });
    const extra = headersWithExtras(o.profile.headers, params.extraHeaders);
    const headers = requestHeaders({ id: 'discover', baseUrl: o.profile.baseUrl, auth: o.profile.auth, headers: extra.headers, ...(o.apiKey ? { apiKey: o.apiKey } : {}) });
    const qs = new URLSearchParams(o.profile.query ?? {}).toString();
    const url = `${o.profile.baseUrl.replace(/\/+$/, '')}${compat.modelsPath}${qs ? `?${qs}` : ''}`;
    const res = await f(url, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(o.timeoutMs ?? DISCOVERY_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const json = await res.json() as { data?: unknown } | unknown[];
    const list = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown }).data) ? (json as { data: unknown[] }).data : null;
    if (!list) return { ok: false, models: [], error: 'the endpoint did not return a model list' };
    const field = compat.contextField;
    const models: ProviderModel[] = [];
    for (const m of list) {
      if (typeof m !== 'object' || m === null) continue;
      const id = (m as Record<string, unknown>)['id'];
      if (typeof id !== 'string' || !id) continue;
      const w = field ? field.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), m) : undefined;
      models.push({ id, ...(typeof w === 'number' && w > 0 ? { contextWindow: Math.floor(w) } : {}) });
    }
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}
