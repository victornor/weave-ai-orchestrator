import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderProfile } from '@weave-ai/shared';
import { probeProvider } from './probe.js';
import { agentUserAgent } from './version.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider, type MockStep } from './testkit/mockProvider.js';

let mock: MockProvider;
beforeEach(async () => { mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); });

const json = (body: unknown): MockStep => ({ raw: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const profile = (over: Partial<ProviderProfile> = {}): ProviderProfile => ({ baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, models: {}, ...over });

describe('probeProvider (mock endpoint only)', () => {
  it('reports each capability and detects that max_completion_tokens is ignored (the recorded Z.ai behaviour)', async () => {
    mock.script(
      json({ data: [{ id: 'm1' }, { id: 'm2' }] }),
      { chunks: textChunks('OK') },
      { chunks: toolCallChunks([{ id: 'c1', name: 'get_time', args: '{"city":"Paris"}' }]) },
      json({ choices: [{ finish_reason: 'length' }], usage: { completion_tokens: 16 } }),
      json({ choices: [{ finish_reason: 'stop' }], usage: { completion_tokens: 51 } }),
    );
    const captured: string[] = [];
    const r = await probeProvider({ profile: profile({ preset: 'openai' }), model: 'm1', apiKey: 'sk-probe-key', onCapture: (n) => captured.push(n) });
    expect(r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)).toEqual(['PASS models list', 'PASS streamed answer', 'PASS usage reported', 'PASS tool call', 'PASS output cap']);
    expect(r.ok).toBe(true);
    expect(r.detected.maxTokensParam).toBe('max_tokens');
    expect(captured).toEqual(['models', 'chat', 'tools', 'cap-max_tokens', 'cap-max_completion_tokens']);
    expect(mock.requests.map((q) => `${q.method} ${q.url}`)).toEqual(['GET /v1/models', 'POST /v1/chat/completions', 'POST /v1/chat/completions', 'POST /v1/chat/completions', 'POST /v1/chat/completions']);
    expect(mock.requests[0]!.headers['authorization']).toBe('Bearer sk-probe-key');
    expect(mock.requests[0]!.headers['user-agent']).toBe(agentUserAgent());
    expect(mock.requests[3]!.body).toMatchObject({ max_tokens: 16 });
    expect(mock.requests[4]!.body).toMatchObject({ max_completion_tokens: 16 });
  });
  it('turns every failure into a check and never throws; a 402 is named as quota', async () => {
    mock.script(...Array.from({ length: 5 }, (): MockStep => ({ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' })));
    const r = await probeProvider({ profile: profile(), model: 'm1' });
    expect(r.ok).toBe(false);
    expect(r.checks.every((c) => !c.ok)).toBe(true);
    expect(r.checks[0]!.detail).toContain('quota_exhausted (provider_quota)');
    expect(r.detected.tools).toEqual({ supported: false });
  });
  it('uses the profile\'s modelsPath, query and extra headers', async () => {
    mock.script(json({ data: [{ id: 'a' }] }));
    await probeProvider({ profile: profile({ query: { 'api-version': '2025-01-01' }, params: { extraHeaders: ['X-Team: ci'] }, compat: { modelsPath: '/deployments' } }), model: 'a', apiKey: 'k' });
    expect(mock.requests[0]!.url).toBe('/v1/deployments?api-version=2025-01-01');
    expect(mock.requests[0]!.headers['x-team']).toBe('ci');
  });
});
