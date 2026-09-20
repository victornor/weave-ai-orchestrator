import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INTERRUPTED, runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, ChildPartial, ChildResult, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { frame, startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';
import { startMockMcp, type MockMcp } from './testkit/mockMcp.js';

const KEY = 'sk-test-secret-key-123';
let dir: string; let mock: MockProvider; let mcp: MockMcp | undefined;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-loop-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); await mcp?.close(); mcp = undefined; rmSync(dir, { recursive: true, force: true }); });

function makeInit(over: { prompt?: string; options?: Record<string, unknown>; mcpServers?: InitMessage['mcpServers']; toolEnv?: Record<string, string>; maxTurns?: number; session?: string; mode?: 'auto' | 'restricted' | 'bypass' } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-abc123', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000, ...(over.maxTurns ? { maxTurns: over.maxTurns } : {}) }, permission: { mode: over.mode ?? 'auto' }, model: 'mock-model', options: over.options ?? {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: KEY },
    prompt: over.prompt ?? 'hello', systemPrompt: { text: 'HOME INSTRUCTIONS', mode: 'inject' },
    session: { path: join(dir, over.session ?? 's.jsonl'), id: 'sess1' }, mcpServers: over.mcpServers ?? {}, toolEnv: { PATH: process.env['PATH'] ?? '', ...over.toolEnv },
  };
}
function harness(hooks: { onEvent?: (e: ChildEvent) => void } = {}): { io: LoopIO; events: ChildEvent[]; partials: ChildPartial[]; types: () => string[] } {
  const events: ChildEvent[] = []; const partials: ChildPartial[] = [];
  return { events, partials, types: () => events.map((e) => e.type), io: { emit: (e) => { events.push(e); hooks.onEvent?.(e); }, partial: (p) => partials.push(p), log: () => undefined } };
}
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
const until = async (cond: () => boolean): Promise<void> => { while (!cond()) await new Promise((r) => setTimeout(r, 5)); };

/** A persisted history is valid when every assistant tool call is followed by a result for it. */
function assertValidHistory(path: string): void {
  const s = Session.open({ path, id: 'x', cwd: dir });
  const m = s.messages;
  for (let i = 0; i < m.length; i++) {
    const cur = m[i]!;
    if (cur.role !== 'assistant') continue;
    const ids = cur.content.filter((b) => b.type === 'toolCall').map((b) => (b as { id: string }).id);
    const after = m.slice(i + 1, i + 1 + ids.length);
    expect(after.map((x) => (x.role === 'toolResult' ? x.toolCallId : null))).toEqual(ids);
  }
  s.close();
}

describe('a turn', () => {
  it('streams text, tool call before execution, tool result, usage and completion, with matching partIds', async () => {
    writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\nbeta\n');
    mock.script({ chunks: toolCallChunks([{ id: 'call_1', name: 'read', args: '{"path":"a.txt"}' }]) }, { chunks: textChunks('The file says alpha.') });
    const h = harness();
    const r = await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    expect(h.types()).toEqual(['turn.started', 'usage.delta', 'tool.call', 'tool.result', 'turn.started', 'assistant.text', 'usage.delta', 'turn.completed']);
    const call = h.events.find((e) => e.type === 'tool.call')!;
    expect(call.payload).toMatchObject({ id: 'call_1', name: 'read', input: { path: 'a.txt' } });
    expect(h.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ id: 'call_1', isError: false, content: '1\talpha\n2\tbeta' });
    const text = h.events.find((e) => e.type === 'assistant.text')!;
    expect(text.payload).toMatchObject({ text: 'The file says alpha.', partId: 'run-abc123:2:t' });
    expect(h.partials.filter((p) => p.kind === 'text').map((p) => p.text).join('')).toBe('The file says alpha.');
    expect(h.partials.filter((p) => p.kind === 'text').every((p) => p.partId === 'run-abc123:2:t')).toBe(true);
    expect(h.partials.filter((p) => p.kind === 'tool_input').map((p) => p.text).join('')).toBe('{"path":"a.txt"}');
    expect(h.partials.find((p) => p.kind === 'tool_input')!.partId).toBe('call_1');
    expect(r).toMatchObject({ exitCode: 0, finalText: 'The file says alpha.', model: 'mock-model', provider: 'mock' });
    expect(r.usage).toMatchObject({ inputTokens: 30, outputTokens: 11, contextTokens: 10, basis: 'per_turn', firstRequest: { freshTokens: 20, cachedTokens: 0 } });
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('sends the key only as the bearer header, the tool env without it, and the system prompt with the home instructions', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'c', name: 'bash', args: '{"command":"env"}' }]) }, { chunks: textChunks('done') });
    const h = harness();
    await runAgentTurn(makeInit({ toolEnv: { LEAKY: `prefix-${KEY}`, SAFE: 'ok' } }), h.io, new AbortController().signal, fast);
    expect(mock.requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    const out = String(h.events.find((e) => e.type === 'tool.result')!.payload['content']);
    expect(out).toContain('SAFE=ok');
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('LEAKY');
    const msgs = mock.requests[0]!.body['messages'] as Array<{ role: string; content: string }>;
    expect(msgs[0]!.content).toContain('HOME INSTRUCTIONS');
    expect(JSON.stringify(mock.requests.map((q) => q.body))).not.toContain(KEY);
  });

  it('omits every parameter not set and sends the ones that are', async () => {
    mock.script({ chunks: textChunks('a') }, { chunks: textChunks('b') });
    await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    for (const k of ['temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'frequency_penalty', 'presence_penalty', 'seed', 'stop', 'reasoning_effort']) expect(mock.requests[0]!.body).not.toHaveProperty(k);
    await runAgentTurn(makeInit({ session: 's2.jsonl', options: { temperature: 0.3, topP: 0.8, maxOutputTokens: 512, contextWindowTokens: 32000 } }), harness().io, new AbortController().signal, fast);
    expect(mock.requests[1]!.body).toMatchObject({ temperature: 0.3, top_p: 0.8, max_tokens: 512 });
    expect(mock.requests[1]!.body).not.toHaveProperty('contextWindowTokens');
  });

  it('resumes: a second turn sends the first turn\'s messages', async () => {
    mock.script({ chunks: textChunks('first answer') }, { chunks: textChunks('second answer') });
    await runAgentTurn(makeInit({ prompt: 'question one' }), harness().io, new AbortController().signal, fast);
    await runAgentTurn(makeInit({ prompt: 'question two' }), harness().io, new AbortController().signal, fast);
    const msgs = mock.requests[1]!.body['messages'] as Array<{ role: string; content: string }>;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1]!.content).toContain('question one');
    expect(msgs[2]!.content).toBe('first answer');
    expect(msgs[3]!.content).toBe('question two');
  });

  it('calls weave_* over MCP with the run bearer header and returns the text', async () => {
    mcp = await startMockMcp([{ name: 'weave_ticket_get' }], (n, a) => `ticket ${String(a['id'])}`);
    mock.script({ chunks: toolCallChunks([{ id: 'm1', name: 'weave_ticket_get', args: '{"id":"VS-9"}' }]) }, { chunks: textChunks('ok') });
    const h = harness();
    await runAgentTurn(makeInit({ mcpServers: { 'weave-ai': { url: mcp.url, headers: { Authorization: 'Bearer run-token-1' } } } }), h.io, new AbortController().signal, fast);
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]!.headers['authorization']).toBe('Bearer run-token-1');
    expect(h.events.find((e) => e.type === 'tool.result')!.payload['content']).toBe('ticket VS-9');
    const names = (mock.requests[0]!.body['tools'] as Array<{ function: { name: string } }>).map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['read', 'bash', 'weave_ticket_get']));
    expect(JSON.stringify(mock.requests.map((q) => q.body))).not.toContain('run-token-1');
  });

  it('ends the turn with tooling/mcp_unavailable when the Weave server cannot be listed', async () => {
    const h = harness();
    const r = await runAgentTurn(makeInit({ mcpServers: { 'weave-ai': { url: 'http://127.0.0.1:1/mcp' } } }), h.io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ code: 'mcp_unavailable', family: 'tooling' });
    expect(r.exitCode).toBe(1);
    expect(mock.requests).toHaveLength(0);
  });

  it('gives the model a corrective result for an unknown tool and for invalid arguments', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'u1', name: 'nope', args: '{}' }, { id: 'u2', name: 'read', args: '{"path":' }]) }, { chunks: textChunks('sorry') });
    const h = harness();
    await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    const results = h.events.filter((e) => e.type === 'tool.result').map((e) => String(e.payload['content']));
    expect(results[0]).toMatch(/^Error: unknown tool "nope"\. Available: read, bash/);
    expect(results[1]).toMatch(/^Error: arguments for read are not valid JSON/);
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('gives a restricted turn no shell', async () => {
    mock.script({ chunks: textChunks('x') });
    await runAgentTurn(makeInit({ mode: 'restricted' }), harness().io, new AbortController().signal, fast);
    expect((mock.requests[0]!.body['tools'] as Array<{ function: { name: string } }>).map((t) => t.function.name)).toEqual(['read']);
  });

  it('stops at the step cap with resource/max_steps', async () => {
    mock.script(...Array.from({ length: 3 }, () => ({ chunks: toolCallChunks([{ id: 'c', name: 'read', args: '{"path":"."}' }]) })));
    const r = await runAgentTurn(makeInit({ maxTurns: 2 }), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ code: 'max_steps', family: 'resource' });
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('estimates usage when the provider reports none', async () => {
    mock.script({ chunks: textChunks('hello there', 'mock-model', undefined) });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.usage!.inputTokens).toBeGreaterThan(0);
    expect(r.usage!.outputTokens).toBeGreaterThan(0);
  });
});

describe('provider failures', () => {
  it('retries a 503 and then succeeds', async () => {
    mock.script({ status: 503, body: '{"error":{"message":"busy"}}' }, { chunks: textChunks('ok') });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.exitCode).toBe(0);
    expect(mock.requests).toHaveLength(2);
  });
  it('honours retry-after', async () => {
    const waits: number[] = [];
    mock.script({ status: 429, headers: { 'retry-after': '7' }, body: '{}' }, { chunks: textChunks('ok') });
    await runAgentTurn(makeInit(), harness().io, new AbortController().signal, { ...fast, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([7000]);
  });
  it('re-sends once without stream_options when a 400 names it, and stays without it for the rest of the run', async () => {
    mock.script({ status: 400, body: '{"error":{"message":"Unknown parameter: \'stream_options\'"}}' }, { chunks: toolCallChunks([{ id: 'c', name: 'read', args: '{"path":"."}' }]) }, { chunks: textChunks('done') });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r).toMatchObject({ exitCode: 0, finalText: 'done' });
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests[0]!.body).toHaveProperty('stream_options');
    expect(mock.requests[1]!.body).not.toHaveProperty('stream_options');
    expect(mock.requests[2]!.body).not.toHaveProperty('stream_options');
  });
  it('does not drop stream_options for a 400 that does not name it', async () => {
    mock.script({ status: 400, body: '{"error":{"message":"bad model"}}' });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ code: 'invalid_request' });
    expect(mock.requests).toHaveLength(1);
  });
  it('does not retry a 402: quota', async () => {
    mock.script({ status: 402, body: '{"error":{"message":"Insufficient Balance","type":"unknown_error","code":"invalid_request_error"}}' });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ family: 'provider_quota', code: 'quota_exhausted' });
    expect(mock.requests).toHaveLength(1);
  });
  it('gives up on a 500 after the retries and reports the family', async () => {
    mock.script(...Array.from({ length: 3 }, () => ({ status: 500, body: 'boom' })));
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ family: 'transient_upstream' });
    expect(mock.requests).toHaveLength(3);
  });
  it('redoes the request when the stream drops mid-way', async () => {
    const bytes = frame(textChunks('complete answer'));
    mock.script({ raw: bytes, dropAfterBytes: 60 }, { raw: bytes });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r).toMatchObject({ exitCode: 0, finalText: 'complete answer' });
    expect(mock.requests).toHaveLength(2);
  });
  it('fails the step on an error object inside a 200 stream', async () => {
    mock.script({ raw: 'data: {"error":{"message":"upstream exploded","type":"server_error"}}\n\n' });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ message: 'upstream exploded' });
    expect(r.exitCode).toBe(1);
  });
  it('splits the wire at every kind of boundary without changing the turn', async () => {
    const bytes = frame(textChunks('Héllo wörld — 日本語'));
    mock.script({ raw: bytes, splitAt: [1, 7, 30, 61, 62, 63, 90] });
    const r = await runAgentTurn(makeInit(), harness().io, new AbortController().signal, fast);
    expect(r.finalText).toBe('Héllo wörld — 日本語');
  });
});

describe('cancel', () => {
  async function cancelWhen(setup: () => void, trigger: (ac: AbortController, h: ReturnType<typeof harness>) => Promise<void> | void, init = makeInit()): Promise<{ r: ChildResult; h: ReturnType<typeof harness> }> {
    setup();
    const ac = new AbortController();
    const h = harness();
    const p = runAgentTurn(init, h.io, ac.signal, fast);
    await trigger(ac, h);
    return { r: await p, h };
  }
  const finishes = (r: ChildResult): void => { expect(r.exitCode).toBe(143); expect(r.signal).toBe('SIGTERM'); assertValidHistory(join(dir, 's.jsonl')); };

  it('while waiting for response headers', async () => {
    const { r } = await cancelWhen(() => mock.script({ stall: true }), async (ac) => { await until(() => mock.requests.length === 1); ac.abort(); });
    finishes(r);
  });
  it('mid-stream, keeping the text seen so far', async () => {
    const first = `data: ${JSON.stringify(textChunks('partial words here')[0])}\n\n`;
    const { r } = await cancelWhen(() => mock.script({ raw: first, stall: true }), async (ac, hh) => { await until(() => hh.partials.length > 0); ac.abort(); });
    finishes(r);
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'x', cwd: dir });
    expect(s.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'partial words here' }] });
    s.close();
  });
  it('during a bash tool: the subprocess is killed and the call gets a result', async () => {
    const { r, h } = await cancelWhen(() => mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: '{"command":"sleep 30"}' }]) }), async (ac, hh) => { await until(() => hh.types().includes('tool.call')); ac.abort(); });
    finishes(r);
    expect(h.types()).toContain('tool.result');
  });
  it('after the first of two tool calls: the unrun call gets the interrupted result', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'r1', name: 'read', args: '{"path":"."}' }, { id: 'r2', name: 'read', args: '{"path":"."}' }]) });
    const ac = new AbortController();
    const h = harness({ onEvent: (e) => { if (e.type === 'tool.result') ac.abort(); } });
    finishes(await runAgentTurn(makeInit(), h.io, ac.signal, fast));
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'x', cwd: dir });
    expect(s.messages.filter((m) => m.role === 'toolResult').map((m) => [(m as { toolCallId: string }).toolCallId, (m as { text: string }).text === INTERRUPTED])).toEqual([['r1', false], ['r2', true]]);
    s.close();
  });
  it('during an MCP call', async () => {
    let release!: () => void;
    mcp = await startMockMcp([{ name: 'weave_slow' }], () => new Promise<string>((res) => { release = () => res('late'); }));
    const init = makeInit({ mcpServers: { 'weave-ai': { url: mcp.url } } });
    const { r } = await cancelWhen(() => mock.script({ chunks: toolCallChunks([{ id: 's1', name: 'weave_slow', args: '{}' }]) }), async (ac) => { await until(() => mcp!.calls.length === 1); ac.abort(); }, init);
    release?.();
    finishes(r);
  });
  it('during a retry backoff', async () => {
    const init = makeInit();
    mock.script({ status: 503, body: '{}' });
    const ac = new AbortController();
    const h = harness();
    let sleeping!: () => void;
    const slept = new Promise<void>((res) => { sleeping = res; });
    const p = runAgentTurn(init, h.io, ac.signal, { partialFlushMs: 1, sleep: (_ms, signal) => new Promise((_, rej) => { sleeping(); signal.addEventListener('abort', () => rej(new Error('cancelled')), { once: true }); }) });
    await slept; ac.abort();
    finishes(await p);
  });
  it('during a partial-flush window the turn still completes its bookkeeping', async () => {
    mock.script({ chunks: textChunks('hi') });
    const ac = new AbortController(); ac.abort();
    const r = await runAgentTurn(makeInit(), harness().io, ac.signal, fast);
    expect(r.exitCode).toBe(143);
    assertValidHistory(join(dir, 's.jsonl'));
    expect(readFileSync(join(dir, 's.jsonl'), 'utf8').split('\n')[0]).toContain('"session"');
  });
});
