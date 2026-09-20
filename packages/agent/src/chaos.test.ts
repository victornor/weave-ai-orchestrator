import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { frame, startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

/** Misbehaving providers, scripted against the mock server. Waits are injected (`sleep`) or bounded by the timer under test, never guessed. */
const KEY = 'sk-chaos-secret-key-987';
let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-chaos-')); mkdirSync(join(dir, 'wt')); writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\n'); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

function makeInit(over: { options?: Record<string, unknown>; maxTurns?: number; params?: InitMessage['provider']['params'] } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-chaos1', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000, ...(over.maxTurns ? { maxTurns: over.maxTurns } : {}) }, permission: { mode: 'auto' }, model: 'mock-model', options: over.options ?? {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: KEY, ...(over.params ? { params: over.params } : {}) },
    prompt: 'go', systemPrompt: { text: 'HOME', mode: 'inject' },
    session: { path: join(dir, 's.jsonl'), id: 'sess1' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
const harness = (): { io: LoopIO; events: ChildEvent[]; logs: string[] } => {
  const events: ChildEvent[] = []; const logs: string[] = [];
  return { events, logs, io: { emit: (e) => events.push(e), partial: () => undefined, log: (_l, m) => logs.push(m) } };
};
const waits: number[] = [];
const fast = (over: LoopDeps = {}): LoopDeps => ({ sleep: async (ms) => { waits.push(ms); }, partialFlushMs: 1, random: () => 0, ...over });
beforeEach(() => { waits.length = 0; });
const run = (init: InitMessage, deps: LoopDeps = fast()) => { const h = harness(); return runAgentTurn(init, h.io, new AbortController().signal, deps).then((r) => ({ r, h })); };

function assertValidHistory(): void {
  const m = Session.open({ path: join(dir, 's.jsonl'), id: 'x', cwd: dir }).messages;
  for (let i = 0; i < m.length; i++) {
    const cur = m[i]!;
    if (cur.role !== 'assistant') continue;
    const ids = cur.content.filter((b) => b.type === 'toolCall').map((b) => (b as { id: string }).id);
    expect(m.slice(i + 1, i + 1 + ids.length).map((x) => (x.role === 'toolResult' ? x.toolCallId : null))).toEqual(ids);
  }
}
const chunk = (delta: unknown, finish: string | null = null, extra: Record<string, unknown> = {}): unknown => ({ id: 'c', object: 'chat.completion.chunk', model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
const readCall = (id = 'c1', args = '{"path":"a.txt"}'): unknown[] => toolCallChunks([{ id, name: 'read', args }]);

describe('dropped and cut streams', () => {
  it('retries a stream whose connection was destroyed mid-way', async () => {
    const bytes = frame(textChunks('complete answer'));
    mock.script({ raw: bytes, dropAfterBytes: 60 }, { raw: bytes });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'complete answer' });
    expect(mock.requests).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });
  it('retries a stream that ends cleanly with text but no finish reason and no [DONE]', async () => {
    mock.script({ raw: `data: ${JSON.stringify(chunk({ content: 'half an ans' }))}\n\n` }, { chunks: textChunks('whole answer') });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'whole answer' });
    expect(mock.requests).toHaveLength(2);
  });
  it('accepts a stream with a finish reason but no [DONE]', async () => {
    mock.script({ chunks: textChunks('fine'), noDone: true });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'fine' });
    expect(mock.requests).toHaveLength(1);
  });
  it('retries an error object that arrives inside a 200 stream when it is transient', async () => {
    mock.script({ raw: 'data: {"error":{"message":"The server is overloaded","type":"server_error"}}\n\n' }, { chunks: textChunks('ok') });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'ok' });
    expect(mock.requests).toHaveLength(2);
  });
  it('reads an `event: error` frame as an error too', async () => {
    mock.script({ raw: 'event: error\ndata: {"message":"Insufficient Balance"}\n\n' });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'quota_exhausted', family: 'provider_quota' });
    expect(mock.requests).toHaveLength(1);
  });
});

describe('stalls and timeouts', () => {
  it('times out a stream that goes silent and retries it', async () => {
    mock.script({ stall: true }, { chunks: textChunks('after the stall') });
    const { r, h } = await run(makeInit(), fast({ idleTimeoutMs: 60 }));
    expect(r).toMatchObject({ exitCode: 0, finalText: 'after the stall' });
    expect(mock.requests).toHaveLength(2);
    expect(h.logs).toContain('provider request failed; retrying');
  });
  it('fails as a transient timeout when every attempt stalls', async () => {
    mock.script(...Array.from({ length: 5 }, () => ({ stall: true })));
    const { r } = await run(makeInit(), fast({ idleTimeoutMs: 30 }));
    expect(r.error).toMatchObject({ code: 'timeout', family: 'transient_upstream' });
    expect(r.error!.message).toContain('idle timeout');
    expect(mock.requests).toHaveLength(5);
  });
  it('keeps waiting while SSE comment lines arrive, longer than the idle window in total', async () => {
    const ka = ': keepalive\n\n';
    const raw = ka.repeat(6) + frame(textChunks('still here'));
    mock.script({ raw, splitAt: Array.from({ length: 6 }, (_v, i) => (i + 1) * ka.length), pieceDelayMs: 40 });
    const { r } = await run(makeInit(), fast({ idleTimeoutMs: 120 }));
    expect(r).toMatchObject({ exitCode: 0, finalText: 'still here' });
    expect(mock.requests).toHaveLength(1);
  });
  it('times out a server that never sends headers (connect timeout)', async () => {
    mock.script({ delayMs: 400, chunks: textChunks('too late') }, { chunks: textChunks('prompt') });
    const { r } = await run(makeInit(), fast({ connectTimeoutMs: 40 }));
    expect(r).toMatchObject({ exitCode: 0, finalText: 'prompt' });
    expect(mock.requests).toHaveLength(2);
  });
  it('cuts a request that keeps trickling past the whole-request limit', async () => {
    const ka = ': k\n\n';
    mock.script({ raw: ka.repeat(50), splitAt: Array.from({ length: 49 }, (_v, i) => (i + 1) * ka.length), pieceDelayMs: 10 }, { chunks: textChunks('done') });
    const { r, h } = await run(makeInit(), fast({ idleTimeoutMs: 1000, requestTimeoutMs: 80 }));
    expect(r).toMatchObject({ exitCode: 0, finalText: 'done' });
    expect(h.logs).toContain('provider request failed; retrying');
  });
  it('a refused connection gets three tries as tooling/endpoint_unreachable', async () => {
    // A port that was just listening and is now closed refuses the connection.
    const gone = await startMockProvider(); const url = gone.baseUrl; await gone.close();
    const init = makeInit();
    init.provider.baseUrl = url;
    const { r } = await run(init);
    expect(r.error).toMatchObject({ code: 'endpoint_unreachable', family: 'tooling' });
    expect(waits).toHaveLength(3);
  });
});

describe('429 storm and Retry-After', () => {
  it('backs off through the ladder, then fails rate_limited carrying retryAfterMs', async () => {
    mock.script(...Array.from({ length: 6 }, () => ({ status: 429, headers: { 'retry-after': '1' }, body: '{"error":{"message":"slow down"}}' })));
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'rate_limited', family: 'transient_upstream', retryAfterMs: 1000 });
    expect(mock.requests).toHaveLength(5);
    expect(waits).toEqual([2000, 4000, 8000, 16_000]);
  });
  it('waits at least a Retry-After given as an HTTP date', async () => {
    const at = Date.parse('Sun, 20 Sep 2026 03:00:00 GMT');
    mock.script({ status: 429, headers: { 'retry-after': 'Sun, 20 Sep 2026 03:00:10 GMT' }, body: '{}' }, { chunks: textChunks('ok') });
    const { r } = await run(makeInit(), fast({ now: () => at }));
    expect(r.exitCode).toBe(0);
    expect(waits).toEqual([10_000]);
  });
  it('does not sit through a Retry-After above two minutes: it surfaces for the engine to decide', async () => {
    mock.script({ status: 429, headers: { 'retry-after': '600' }, body: '{}' });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'rate_limited', retryAfterMs: 600_000 });
    expect(mock.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });
  it('does not start a retry that would end after the run deadline', async () => {
    mock.script({ status: 503, body: '{}' });
    const init = makeInit();
    init.run.limits.timeoutMs = 31_000;
    const { r } = await run(init, fast({ now: () => 1_000_000 }));
    expect(r.exitCode).toBe(1);
    expect(mock.requests).toHaveLength(1);
  });
});

describe('gateways and quota', () => {
  it('retries "routes failed after N attempts" once, then fails, and does not retry endlessly', async () => {
    const body = '{"error":{"message":"All available provider routes failed after 6 attempts. If it keeps happening, contact support and quote the request id.","type":"api_error","param":null,"code":"upstream_error"}}';
    mock.script(...Array.from({ length: 5 }, () => ({ status: 502, body })));
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'gateway_routes_failed', family: 'transient_upstream' });
    expect(mock.requests).toHaveLength(2);
  });
  it('the same gateway failure as a 400 is capped the same way', async () => {
    const body = '{"error":{"message":"All available provider routes failed after 4 attempts.","type":"invalid_request_error","code":"invalid_request"}}';
    mock.script(...Array.from({ length: 5 }, () => ({ status: 400, body })));
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'gateway_routes_failed' });
    expect(mock.requests).toHaveLength(2);
  });
  it('a 402 is quota and is not retried', async () => {
    mock.script({ status: 402, body: '{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}' });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'quota_exhausted', family: 'provider_quota' });
    expect(mock.requests).toHaveLength(1);
  });
});

describe('malformed tool calls', () => {
  it('runs a call whose arguments were torn before the closing brace', async () => {
    mock.script({ chunks: readCall('c1', '{"path":"a.txt"') }, { chunks: textChunks('read it') });
    const { r, h } = await run(makeInit());
    expect(r.finalText).toBe('read it');
    expect(h.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ isError: false, content: '1\talpha' });
    assertValidHistory();
  });
  it('gives the model a corrective result for unrepairable arguments and runs nothing', async () => {
    mock.script({ chunks: readCall('c1', '{"path": nope}') }, { chunks: textChunks('sorry') });
    const { h } = await run(makeInit());
    const res = h.events.find((e) => e.type === 'tool.result')!.payload;
    expect(res).toMatchObject({ isError: true });
    expect(String(res['content'])).toMatch(/^Error: the arguments for read are not valid JSON/);
    assertValidHistory();
  });
  it('does not close a call that the output limit cut off: it is invalid, not run', async () => {
    mock.script({ raw: frame([chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"' } }] }, 'length')]) }, { chunks: textChunks('ok') });
    const { h } = await run(makeInit());
    expect(h.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ isError: true });
  });
  it('fails the turn after three invalid calls in a row, with a valid history', async () => {
    mock.script(...Array.from({ length: 4 }, () => ({ chunks: readCall('c', '{"path": nope}') })));
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'tool_call_invalid', family: 'tooling' });
    expect(r.exitCode).toBe(1);
    expect(mock.requests).toHaveLength(3);
    assertValidHistory();
  });
  it('a valid call in between resets the count', async () => {
    mock.script(
      { chunks: readCall('c1', '{"path": nope}') }, { chunks: readCall('c2', '{"path": nope}') }, { chunks: readCall('c3', '{"path":"a.txt"}') },
      { chunks: readCall('c4', '{"path": nope}') }, { chunks: readCall('c5', '{"path": nope}') }, { chunks: textChunks('finally') },
    );
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'finally' });
  });
  it('treats an unknown tool as invalid too', async () => {
    mock.script(...Array.from({ length: 3 }, (_v, i) => ({ chunks: toolCallChunks([{ id: `u${i}`, name: 'nope', args: '{}' }]) })));
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'tool_call_invalid' });
  });
});

describe('assembler chaos', () => {
  it('keeps two parallel calls apart when the provider reuses index 0 with different ids', async () => {
    mock.script({ chunks: [
      chunk({ tool_calls: [{ index: 0, id: 'first', type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"}' } }] }),
      chunk({ tool_calls: [{ index: 0, id: 'second', type: 'function', function: { name: 'read', arguments: '{"path":"."}' } }] }),
      chunk({}, 'tool_calls'),
    ] }, { chunks: textChunks('both') });
    const { r, h } = await run(makeInit());
    expect(r.finalText).toBe('both');
    expect(h.events.filter((e) => e.type === 'tool.result').map((e) => e.payload['id'])).toEqual(['first', 'second']);
    assertValidHistory();
  });
  it('keeps two calls apart when the provider reuses index 0 and sends no id, only a new name', async () => {
    mock.script({ chunks: [
      chunk({ tool_calls: [{ index: 0, function: { name: 'read', arguments: '{"path":"a.txt"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: 'bash', arguments: '{"command":"echo hi"}' } }] }),
      chunk({}, 'tool_calls'),
    ] }, { chunks: textChunks('both') });
    const { h } = await run(makeInit());
    expect(h.events.filter((e) => e.type === 'tool.call').map((e) => e.payload['name'])).toEqual(['read', 'bash']);
    assertValidHistory();
  });
  it('generates an id for a call that arrives without one and pairs its result', async () => {
    mock.script({ chunks: [chunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"}' } }] }), chunk({}, 'tool_calls')] }, { chunks: textChunks('ok') });
    const { h } = await run(makeInit());
    const call = h.events.find((e) => e.type === 'tool.call')!.payload;
    expect(String(call['id'])).toMatch(/^call_/);
    expect(h.events.find((e) => e.type === 'tool.result')!.payload['id']).toBe(call['id']);
    assertValidHistory();
  });
});

describe('guards and stops', () => {
  it('refuses a fourth identical call once, then stops the turn doom_loop', async () => {
    mock.script(...Array.from({ length: 6 }, () => ({ chunks: readCall('c', '{"path":"a.txt"}') })));
    const { r, h } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'doom_loop', family: 'tooling' });
    const results = h.events.filter((e) => e.type === 'tool.result').map((e) => String(e.payload['content']));
    expect(results.filter((c) => c === '1\talpha')).toHaveLength(3);
    expect(results[3]).toContain('same result');
    expect(mock.requests).toHaveLength(5);
    assertValidHistory();
  });
  it('a model that heeds the warning carries on', async () => {
    mock.script(...Array.from({ length: 4 }, () => ({ chunks: readCall('c', '{"path":"a.txt"}') })), { chunks: readCall('d', '{"path":"."}') }, { chunks: textChunks('changed course') });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'changed course' });
  });
  it('the step cap is tooling/max_steps, not resource', async () => {
    mock.script(...Array.from({ length: 3 }, (_v, i) => ({ chunks: readCall(`c${i}`, i === 0 ? '{"path":"a.txt"}' : '{"path":"."}') })));
    const { r } = await run(makeInit({ maxTurns: 2 }));
    expect(r.error).toMatchObject({ code: 'max_steps', family: 'tooling' });
  });
  it('stops when the turn token budget is spent', async () => {
    mock.script({ chunks: readCall() }, { chunks: textChunks('never') });
    const { r } = await run(makeInit({ options: { maxTurnTokens: 20 } }));
    expect(r.error).toMatchObject({ code: 'budget_exhausted', family: 'tooling' });
    expect(mock.requests).toHaveLength(1);
    assertValidHistory();
  });
  it('stops on a content filter as a refusal, without retrying', async () => {
    mock.script({ chunks: [chunk({ content: 'I' }, 'content_filter')] });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'refusal', family: 'model_refusal' });
    expect(mock.requests).toHaveLength(1);
  });
  it('reads message.refusal as a refusal', async () => {
    mock.script({ chunks: [chunk({ refusal: 'I cannot do that' }, 'stop')] });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'refusal', message: 'I cannot do that' });
  });
});

describe('finish_reason: length', () => {
  it('asks the model to continue once and keeps both halves', async () => {
    mock.script({ chunks: [chunk({ content: 'first half ' }, 'length')] }, { chunks: textChunks('second half') });
    const { r } = await run(makeInit());
    expect(r).toMatchObject({ exitCode: 0, finalText: 'second half' });
    const msgs = mock.requests[1]!.body['messages'] as Array<{ role: string; content?: string }>;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[2]!.content).toBe('first half ');
    expect(msgs[3]!.content).toContain('cut off by the output limit');
  });
  it('fails output_truncated on the second truncation, as tooling', async () => {
    mock.script({ chunks: [chunk({ content: 'a' }, 'length')] }, { chunks: [chunk({ content: 'b' }, 'length')] });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'output_truncated', family: 'tooling' });
    expect(mock.requests).toHaveLength(2);
  });
  it('fails at once when the cap was spent on reasoning and no text came back', async () => {
    mock.script({ chunks: [chunk({ content: null, reasoning_content: 'thinking hard' }, 'length')] });
    const { r } = await run(makeInit());
    expect(r.error).toMatchObject({ code: 'output_truncated' });
    expect(mock.requests).toHaveLength(1);
  });
});

describe('debugWire', () => {
  it('writes a redacted capture outside the worktree, with no key anywhere in it', async () => {
    mock.script({ status: 429, headers: { 'retry-after': '1' }, body: `{"error":{"message":"echo ${KEY}"}}` }, { chunks: textChunks('hello') });
    const init = makeInit({ options: { debugWire: true } });
    init.toolEnv['GITHUB_TOKEN'] = 'ghp_thisIsAFakeTokenValue123';
    await run(init);
    const wire = join(dir, 'wire');
    const files = readdirSync(wire).sort();
    expect(files).toEqual(['1.jsonl', '2.jsonl']);
    const all = files.map((f) => readFileSync(join(wire, f), 'utf8')).join('');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('ghp_thisIsAFakeTokenValue123');
    expect(all).not.toMatch(/bearer\s+sk-/i);
    expect(all).toContain('"authorization":"[redacted]"');
    expect(all).toContain('hello');
    expect(wire.startsWith(join(dir, 'wt'))).toBe(false);
  });
  it('writes nothing unless asked', async () => {
    mock.script({ chunks: textChunks('hello') });
    await run(makeInit());
    expect(existsSync(join(dir, 'wire'))).toBe(false);
  });
  it('shortens an HTML challenge page to one line, does not retry it, and keeps the full body only in the wire capture (VS-631)', async () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'errors', 'cloudflare-challenge.html'), 'utf8');
    mock.script({ status: 503, headers: { 'content-type': 'text/html' }, body: html });
    const { r } = await run(makeInit({ options: { debugWire: true } }));
    expect(mock.requests).toHaveLength(1); // a challenge page is not retried
    expect(r.error).toMatchObject({ code: 'html_error', family: 'tooling' });
    expect(r.error!.message).toBe('HTTP 503: the endpoint returned an HTML page titled "Just a moment..." (likely a bot challenge or a gateway error); try setting a User-Agent header on the provider');
    const wire = readdirSync(join(dir, 'wire')).map((f) => readFileSync(join(dir, 'wire', f), 'utf8')).join('');
    expect(wire).toContain('<title>Just a moment...</title>');
  });
});

describe('unknown context window (VS-631)', () => {
  it('warns with the --context-window hint, and the flag silences it', async () => {
    mock.script({ chunks: textChunks('one') }, { chunks: textChunks('two') });
    const warned = await run(makeInit());
    expect(warned.h.logs.join('\n')).toContain('--context-window');
    const quiet = await run(makeInit({ params: { contextWindowTokens: 128000 } }));
    expect(quiet.h.logs.join('\n')).not.toContain('context window is unknown');
  });
});
