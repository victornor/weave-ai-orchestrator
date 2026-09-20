import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectCapture, runConformance } from './conformance.js';
import { readFixture } from './fixtures.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-conf-')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

describe('conformance harness (against the mock provider only)', () => {
  it('runs a real turn, keeps the raw bytes of each response, and reports every check', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'call_1', name: 'read', args: '{"path":"hello.txt"}' }], 'mock-model') }, { chunks: textChunks('It says hello.') });
    const out = join(dir, 'out');
    const r = await runConformance({ baseUrl: mock.baseUrl, model: 'mock-model', keyEnv: 'CONF_KEY', outDir: out, env: { CONF_KEY: 'sk-secret-conf', PATH: process.env['PATH'] } });
    expect(r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)).toEqual(['PASS turn completed', 'PASS response streamed', 'PASS tool call assembled', 'PASS tool result reached the model', 'PASS final answer', 'PASS usage reported', 'PASS model reported']);
    expect(r.ok).toBe(true);
    expect(readdirSync(out).sort()).toEqual(['report.json', 'request-1.json', 'request-2.json', 'response-1.sse', 'response-2.sse']);
    expect(readFileSync(join(out, 'response-1.sse'), 'utf8')).toContain('"name":"read"');
    expect(mock.requests[0]!.headers['authorization']).toBe('Bearer sk-secret-conf');
    for (const f of readdirSync(out)) expect(readFileSync(join(out, f), 'utf8')).not.toContain('sk-secret-conf');
  });
  it('reports a failing check instead of throwing when the endpoint refuses', async () => {
    mock.script({ status: 401, body: '{"error":{"message":"bad key"}}' });
    const r = await runConformance({ baseUrl: mock.baseUrl, model: 'm', outDir: join(dir, 'out'), env: {} });
    expect(r.ok).toBe(false);
    expect(r.checks[0]).toMatchObject({ name: 'turn completed', ok: false });
    expect(r.checks[0]!.detail).toContain('auth_failed');
  });
  it('refuses an output directory inside a git repository and a missing key variable', async () => {
    await expect(runConformance({ baseUrl: mock.baseUrl, model: 'm', outDir: process.cwd(), env: {} })).rejects.toThrow(/inside a git repository/);
    await expect(runConformance({ baseUrl: mock.baseUrl, model: 'm', keyEnv: 'NOPE', outDir: join(dir, 'o'), env: {} })).rejects.toThrow(/NOPE is not set/);
  });
  it('reads the stream shape out of a capture', () => {
    expect(inspectCapture(readFixture('gateway-gpt-tool.sse'))).toMatchObject({ usage: 'separate_empty_choices', done: true, toolIdRepeats: false, toolNames: ['get_time'], models: ['gpt-5.6-luna'] });
    expect(inspectCapture(readFixture('gateway-deepseek-tool.sse'))).toMatchObject({ usage: 'with_finish', toolIdRepeats: true, reasoningFields: ['reasoning_content'], comments: 1 });
    expect(inspectCapture(readFixture('openrouter-tool-two-finish.sse'))).toMatchObject({ finishChunks: 2, reasoningFields: ['reasoning', 'reasoning_details'] });
  });
});
