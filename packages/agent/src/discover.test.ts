import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from '@weave-ai/shared';
import { listProviderModels } from './discover.js';
import { agentUserAgent } from './version.js';

const base = (over: Partial<ProviderProfile> = {}): ProviderProfile => ({ baseUrl: 'https://llm.example.test/v1', auth: 'bearer', headers: {}, models: {}, ...over });
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('listProviderModels', () => {
  it('returns ids and context windows from the preset\'s contextField, with the profile key and the default User-Agent', async () => {
    const seen: Array<{ url: string; auth: string | null; ua: string | null }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(url), auth: h.get('authorization'), ua: h.get('user-agent') });
      return json({ data: [{ id: 'a', context_length: 65536 }, { id: 'b' }, { nothing: 1 }] });
    }) as typeof fetch;
    const r = await listProviderModels({ profile: base({ preset: 'openrouter', apiKeySecret: 'K' }), apiKey: 'sk-x', fetch: fetchFn });
    expect(r).toEqual({ ok: true, models: [{ id: 'a', contextWindow: 65536 }, { id: 'b' }] });
    expect(seen).toEqual([{ url: 'https://llm.example.test/v1/models', auth: 'Bearer sk-x', ua: agentUserAgent() }]);
  });

  it('accepts a top-level array and honours the profile modelsPath and query', async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => { seen.push(String(url)); return json([{ id: 'a' }]); }) as typeof fetch;
    const r = await listProviderModels({ profile: base({ query: { 'api-version': '1' }, compat: { modelsPath: '/deployments' } }), fetch: fetchFn });
    expect(r).toEqual({ ok: true, models: [{ id: 'a' }] });
    expect(seen).toEqual(['https://llm.example.test/v1/deployments?api-version=1']);
  });

  it('turns a non-200 into a one-line reason rather than throwing', async () => {
    const fetchFn = (async () => json({ error: 'down' }, 500)) as typeof fetch;
    expect(await listProviderModels({ profile: base(), fetch: fetchFn })).toEqual({ ok: false, models: [], error: 'HTTP 500' });
  });

  it('names a body that is not a model list', async () => {
    const fetchFn = (async () => json({ object: 'list' })) as typeof fetch;
    expect(await listProviderModels({ profile: base(), fetch: fetchFn })).toEqual({ ok: false, models: [], error: 'the endpoint did not return a model list' });
  });
});
