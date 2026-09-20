import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
let server: Server | null = null;
afterEach(async () => { await harness?.close(); harness = null; await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null; });

/** A tiny OpenAI-compatible endpoint: models, a stream (text or tool call by prompt), and the two output-cap spellings. */
async function endpoint(): Promise<{ baseUrl: string; seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> }> {
  const seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
  server = createServer((req, res) => {
    let s = ''; req.on('data', (c) => (s += c));
    req.on('end', () => {
      const body = s ? JSON.parse(s) as Record<string, unknown> : {};
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'm1' }] })); return; }
      if (body['stream'] !== true) {
        // Honours max_tokens, ignores max_completion_tokens (the recorded Z.ai behaviour).
        const cap = 'max_tokens' in body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: cap ? 'length' : 'stop' }], usage: { completion_tokens: cap ? 16 : 51 } })); return;
      }
      const tools = Array.isArray(body['tools']);
      const chunks = tools
        ? [{ model: 'm1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{"city":"Paris"}' } }] }, finish_reason: 'tool_calls' }] }, { model: 'm1', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }]
        : [{ model: 'm1', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }, { model: 'm1', choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

const post = (h: Harness, path: string, payload: unknown = {}) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify(payload) }));

describe('POST /providers/:id/test', () => {
  it('runs the probes with the provider\'s secret and reports each capability, never the key', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['mock'] = { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_MOCK_KEY', preset: 'openai', models: { m1: {} } };
    harness.runtime.services.secrets.put({ kind: 'human', id: 'h' } as never, { name: 'WEAVE_LLM_MOCK_KEY' }, 'held');
    const res = await post(harness, '/providers/mock/test');
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; provider: string; model: string; checks: Array<{ name: string; ok: boolean }>; detected: Record<string, unknown> };
    expect(json).toMatchObject({ ok: true, provider: 'mock', model: 'm1' });
    expect(json.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)).toEqual(['PASS models list', 'PASS streamed answer', 'PASS usage reported', 'PASS tool call', 'PASS output cap']);
    expect(json.detected).toEqual({ maxTokensParam: 'max_tokens' });
    expect(ep.seen.map((s) => s.auth)).toEqual(Array(5).fill('Bearer held'));
    expect(JSON.stringify(json)).not.toContain('held');
  });
  it('names a missing secret without calling the endpoint', async () => {
    harness = makeHarness();
    const ep = await endpoint();
    harness.runtime.ctx.config.providers['nokey'] = { baseUrl: ep.baseUrl, auth: 'bearer', headers: {}, apiKeySecret: 'WEAVE_LLM_NOKEY_KEY', models: { m1: {} } };
    const json = await (await post(harness, '/providers/nokey/test')).json() as { ok: boolean; checks: Array<{ detail: string }> };
    expect(json.ok).toBe(false);
    expect(json.checks[0]!.detail).toContain('WEAVE_LLM_NOKEY_KEY');
    expect(ep.seen).toHaveLength(0);
  });
  it('404s an unknown provider and asks for a model when the profile lists none', async () => {
    harness = makeHarness();
    expect((await post(harness, '/providers/ghost/test')).status).toBe(404);
    harness.runtime.ctx.config.providers['bare'] = { baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', headers: {}, models: {} };
    const res = await post(harness, '/providers/bare/test');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('validation');
  });
});
