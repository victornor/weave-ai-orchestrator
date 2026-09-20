import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { startMockProvider, textChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-cloop-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
function init(over: { prompt?: string; options?: Record<string, unknown> } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-abc123', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: 'mock-model', options: over.options ?? {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k' },
    prompt: over.prompt ?? 'next question', systemPrompt: { text: 'HOME INSTRUCTIONS', mode: 'inject' },
    session: { path: join(dir, 's.jsonl'), id: 'sess1' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
function harness(): { io: LoopIO; events: ChildEvent[]; logs: string[] } {
  const events: ChildEvent[] = []; const logs: string[] = [];
  return { events, logs, io: { emit: (e) => events.push(e), partial: () => undefined, log: (_l, msg) => logs.push(msg) } };
}
/** A session with `n` user/assistant exchanges of a few hundred tokens each, the last human message being `LAST HUMAN`. */
function seed(n: number): void {
  const s = Session.open({ path: join(dir, 's.jsonl'), id: 'sess1', cwd: dir });
  for (let i = 0; i < n; i++) {
    s.append({ role: 'user', text: `question ${i} ${'lorem ipsum dolor '.repeat(40)}` });
    s.append({ role: 'assistant', content: [{ type: 'text', text: `answer ${i} ${'sit amet consectetur '.repeat(40)}` }] });
  }
  s.append({ role: 'user', text: 'LAST HUMAN' });
  s.append({ role: 'assistant', content: [{ type: 'text', text: 'noted' }] });
  s.close();
}
const messagesOf = (i: number): Array<{ role: string; content?: unknown }> => mock.requests[i]!.body['messages'] as Array<{ role: string; content?: unknown }>;

describe('compaction in the loop', () => {
  it('compacts before the request when the estimate crosses the threshold, and the request starts with the summary', async () => {
    seed(30);
    mock.script({ chunks: textChunks('## Goal\nanswer questions') }, { chunks: textChunks('all done') });
    const h = harness();
    const r = await runAgentTurn(init({ options: { contextWindowTokens: 8000 } }), h.io, new AbortController().signal, fast);
    expect(r.exitCode).toBe(0);
    expect(mock.requests).toHaveLength(2);
    // the summary request carries no tools and is not shown as a reply
    expect(mock.requests[0]!.body['tools']).toBeUndefined();
    expect(h.events.filter((e) => e.type === 'assistant.text').map((e) => e.payload['text'])).toEqual(['all done']);
    const [sys, first, ...rest] = messagesOf(1);
    expect(sys!.role).toBe('system');
    expect(String(first!.content).startsWith('[Conversation summary]\n## Goal\nanswer questions')).toBe(true);
    expect(rest.length).toBeLessThan(60);
    expect(rest.map((m) => String(m.content)).some((t) => t.includes('next question'))).toBe(true);
    expect(rest.map((m) => String(m.content)).some((t) => t.includes('LAST HUMAN'))).toBe(true);
    const types = h.events.map((e) => e.type);
    expect(types.indexOf('session.compaction.started')).toBeLessThan(types.indexOf('session.compaction.completed'));
    const done = h.events.find((e) => e.type === 'session.compaction.completed')!.payload;
    expect(done).toMatchObject({ ok: true, trigger: 'proactive' });
    expect(done['tokensAfter'] as number).toBeLessThan(done['tokensBefore'] as number);
    // the summary's cost is part of the turn's usage
    expect(r.usage!.outputTokens).toBe(6);
  });

  it('a compacted session resumes: the next turn also starts with the summary', async () => {
    seed(30);
    mock.script({ chunks: textChunks('SUM') }, { chunks: textChunks('one') }, { chunks: textChunks('two') });
    await runAgentTurn(init({ options: { contextWindowTokens: 8000 } }), harness().io, new AbortController().signal, fast);
    await runAgentTurn(init({ prompt: 'again', options: { contextWindowTokens: 8000 } }), harness().io, new AbortController().signal, fast);
    expect(mock.requests).toHaveLength(3);
    expect(String(messagesOf(2)[1]!.content)).toMatch(/^\[Conversation summary\]\nSUM/);
  });

  it('on a 400 overflow compacts once and retries; a second overflow fails the turn', async () => {
    seed(12);
    const overflow = { status: 400, body: JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens", code: 'context_length_exceeded' } }) };
    mock.script(overflow, { chunks: textChunks('SUM') }, { chunks: textChunks('recovered') });
    const h = harness();
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, fast);
    expect(r).toMatchObject({ exitCode: 0, finalText: 'recovered' });
    expect(mock.requests).toHaveLength(3);
    expect(String(messagesOf(2)[1]!.content)).toMatch(/^\[Conversation summary\]/);
    expect(h.events.find((e) => e.type === 'session.compaction.completed')!.payload).toMatchObject({ trigger: 'overflow' });
  });
  it('fails with context_overflow when the retry after compaction overflows too', async () => {
    seed(12);
    const overflow = { status: 400, body: JSON.stringify({ error: { message: 'maximum context length exceeded', code: 'context_length_exceeded' } }) };
    mock.script(overflow, { chunks: textChunks('SUM') }, overflow);
    const r = await runAgentTurn(init(), harness().io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ code: 'context_overflow' });
    expect(mock.requests).toHaveLength(3);
  });

  it('an unknown window disables proactive compaction and warns once', async () => {
    seed(30);
    mock.script({ chunks: textChunks('fine') });
    const h = harness();
    await runAgentTurn(init(), h.io, new AbortController().signal, fast);
    expect(mock.requests).toHaveLength(1);
    expect(h.logs.filter((l) => l.includes('context window is unknown'))).toHaveLength(1);
    expect(readFileSync(join(dir, 's.jsonl'), 'utf8')).not.toContain('"type":"compaction"');
  });

  it('a failed summary leaves the session alone and the turn carries on', async () => {
    seed(30);
    mock.script({ status: 400, body: JSON.stringify({ error: { message: 'bad request', code: 'invalid' } }) }, { chunks: textChunks('still works') });
    const h = harness();
    const r = await runAgentTurn(init({ options: { contextWindowTokens: 8000 } }), h.io, new AbortController().signal, fast);
    expect(r).toMatchObject({ exitCode: 0, finalText: 'still works' });
    expect(readFileSync(join(dir, 's.jsonl'), 'utf8')).not.toContain('"type":"compaction"');
    expect(h.events.find((e) => e.type === 'session.compaction.completed')!.payload).toMatchObject({ ok: false });
  });

  it('prunes old tool output in the request above 70 % of the window without touching the session file', async () => {
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'sess1', cwd: dir });
    s.append({ role: 'user', text: 'start' });
    for (let i = 0; i < 20; i++) {
      s.append({ role: 'assistant', content: [{ type: 'toolCall', id: `c${i}`, name: i % 2 ? 'read' : 'bash', args: {} }] });
      s.append({ role: 'toolResult', toolCallId: `c${i}`, name: i % 2 ? 'read' : 'bash', text: `${i} ` + Array.from({ length: 2000 }, (_, k) => `w${(k * 7 + i) % 900}`).join(' ').slice(0, 12000), isError: false });
    }
    s.append({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
    s.close();
    mock.script({ chunks: textChunks('fine') });
    const h = harness();
    await runAgentTurn(init({ options: { contextWindowTokens: 120_000 } }), h.io, new AbortController().signal, fast);
    expect(h.events.some((e) => e.type === 'session.compaction.started')).toBe(false);
    expect(mock.requests).toHaveLength(1);
    const texts = messagesOf(0).map((m) => String(m.content));
    expect(texts.filter((t) => t.startsWith('[output pruned;')).length).toBeGreaterThan(3);
    expect(texts.filter((t) => t.startsWith('19 ') || t.startsWith('18 '))).toHaveLength(2);
    expect(readFileSync(join(dir, 's.jsonl'), 'utf8')).not.toContain('output pruned');
  });
});
