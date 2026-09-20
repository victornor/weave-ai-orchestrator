import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import { Session } from './session.js';
import { EXPLORE_MAX_STEPS } from './tools/task.js';
import type { ChildEvent, ChildPartial, InitMessage } from './protocol.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-s9-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

function makeInit(over: { mode?: 'auto' | 'restricted' | 'bypass'; permission?: Partial<InitMessage['run']['permission']> } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-s9', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000 }, permission: { mode: over.mode ?? 'auto', ...over.permission }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'sk-test-secret-key-123' },
    prompt: 'go', systemPrompt: { text: '', mode: 'skip' },
    session: { path: join(dir, 's.jsonl'), id: 'sess1' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
function harness(): { io: LoopIO; events: ChildEvent[]; partials: ChildPartial[]; order: string[] } {
  const events: ChildEvent[] = []; const partials: ChildPartial[] = []; const order: string[] = [];
  return { events, partials, order, io: { emit: (e) => { events.push(e); order.push(e.type); }, partial: (p) => { partials.push(p); order.push(`partial:${p.kind}`); }, log: () => undefined } };
}
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };

describe('bash output streaming', () => {
  it('streams tool_output partials while the command runs and the result names the same part', async () => {
    const command = 'echo one; sleep 0.15; echo two; sleep 0.15; echo three';
    mock.script({ chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: JSON.stringify({ command }) }]) }, { chunks: textChunks('done') });
    const h = harness();
    await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    const out = h.partials.filter((p) => p.kind === 'tool_output');
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((p) => p.partId === 'b1:out' && p.toolCallId === 'b1')).toBe(true);
    expect(out.map((p) => p.text).join('')).toBe('one\ntwo\nthree\n');
    const result = h.events.find((e) => e.type === 'tool.result')!;
    expect(result.payload['partId']).toBe('b1:out');
    // Every partial for the call was sent before the result that supersedes it.
    expect(h.order.lastIndexOf('partial:tool_output')).toBeLessThan(h.order.indexOf('tool.result'));
    expect(String(result.payload['content'])).toContain('three');
  });

  it('sends no partial for a command with no output', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 'b2', name: 'bash', args: JSON.stringify({ command: 'true' }) }]) }, { chunks: textChunks('done') });
    const h = harness();
    await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    expect(h.partials.filter((p) => p.kind === 'tool_output')).toEqual([]);
  });
});

const names = (req: { body: Record<string, unknown> }): string[] => (req.body['tools'] as Array<{ function: { name: string } }> | undefined ?? []).map((t) => t.function.name);
const task = (id = 't1', prompt = 'find where alpha is defined') => toolCallChunks([{ id, name: 'task', args: JSON.stringify({ description: 'find alpha', prompt }) }]);

describe('the explore subagent', () => {
  it('returns only its final text and nests its events under the task call', async () => {
    writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\nbeta\n');
    mock.script(
      { chunks: task() },
      { chunks: toolCallChunks([{ id: 'r1', name: 'read', args: JSON.stringify({ path: 'a.txt' }) }]) },
      { chunks: textChunks('alpha is defined on line 1 of a.txt') },
      { chunks: textChunks('done') },
    );
    const h = harness();
    const r = await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    expect(r.exitCode).toBe(0);
    expect(mock.requests).toHaveLength(4);
    // The subagent's own request: a fresh history, its own system prompt and only the read-only tools.
    const sub = mock.requests[1]!.body['messages'] as Array<{ role: string; content?: string }>;
    expect(sub[0]!.role).toBe('system');
    expect(sub[0]!.content).toContain('explore subagent');
    expect(sub.map((m) => m.role)).toEqual(['system', 'user']);
    expect(names(mock.requests[1]!)).toEqual(['read', 'grep', 'glob']);
    // The parent's next request holds one tool result: the answer, and none of the subagent's reading.
    const parent = mock.requests[3]!.body['messages'] as Array<{ role: string; content?: string; tool_call_id?: string }>;
    const results = parent.filter((m) => m.role === 'tool');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ tool_call_id: 't1', content: 'alpha is defined on line 1 of a.txt' });
    expect(JSON.stringify(parent)).not.toContain('1\talpha');
    // Events: the task call is top level; the subagent's carry parentId and never collide with it.
    const nested = h.events.filter((e) => e.payload['parentId'] === 't1');
    expect(nested.map((e) => e.type)).toEqual(['tool.call', 'tool.result', 'assistant.text']);
    expect(nested[0]!.payload).toMatchObject({ id: 't1/1', name: 'read' });
    expect(nested[1]!.payload).toMatchObject({ id: 't1/1', isError: false });
    expect(String(nested[1]!.payload['content'])).toContain('alpha');
    const top = h.events.filter((e) => e.payload['parentId'] === undefined && (e.type === 'tool.call' || e.type === 'tool.result'));
    expect(top.map((e) => `${e.type}:${String(e.payload['id'])}`)).toEqual(['tool.call:t1', 'tool.result:t1']);
    // Its tokens count toward the turn, and the persisted session has the answer, not the reading.
    expect(r.usage!.outputTokens).toBe(8 + 8 + 3 + 3);
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'x', cwd: dir });
    expect(JSON.stringify(s.messages)).not.toContain('r1');
    s.close();
  });

  it('cannot write, run commands or start a subagent of its own', async () => {
    const victim = join(dir, 'wt', 'victim.txt');
    writeFileSync(victim, 'keep');
    mock.script(
      { chunks: task() },
      { chunks: toolCallChunks([
        { id: 'w', name: 'edit', args: JSON.stringify({ path: 'victim.txt', old_string: 'keep', new_string: 'gone' }) },
        { id: 'b', name: 'bash', args: JSON.stringify({ command: 'touch ran.txt' }) },
        { id: 'n', name: 'task', args: JSON.stringify({ description: 'nest', prompt: 'again' }) },
      ]) },
      { chunks: textChunks('nothing found') },
      { chunks: textChunks('done') },
    );
    const h = harness();
    await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    expect(readFileSync(victim, 'utf8')).toBe('keep');
    expect(existsSync(join(dir, 'wt', 'ran.txt'))).toBe(false);
    const results = h.events.filter((e) => e.type === 'tool.result' && e.payload['parentId'] === 't1');
    expect(results).toHaveLength(3);
    for (const e of results) { expect(e.payload['isError']).toBe(true); expect(String(e.payload['content'])).toContain('unknown tool'); }
    // No request other than the parent's carries `task`.
    expect(mock.requests.map((q) => names(q).includes('task'))).toEqual([true, false, false, true]);
  });

  it('is offered in restricted mode, and honours deniedTools', async () => {
    mock.script({ chunks: textChunks('a') }, { chunks: textChunks('b') });
    await runAgentTurn(makeInit({ mode: 'restricted' }), harness().io, new AbortController().signal, fast);
    expect(names(mock.requests[0]!)).toEqual(['read', 'grep', 'glob', 'todo_write', 'task']);
    await runAgentTurn(makeInit({ permission: { deniedTools: ['Task'] } }), harness().io, new AbortController().signal, fast);
    expect(names(mock.requests[1]!)).not.toContain('task');
    expect(names(mock.requests[1]!)).toContain('read');
  });

  it('stops after its step cap and returns what it had', async () => {
    writeFileSync(join(dir, 'wt', 'a.txt'), 'x');
    const read = (i: number) => ({ chunks: toolCallChunks([{ id: `r${i}`, name: 'read', args: JSON.stringify({ path: 'a.txt' }) }]) });
    mock.script({ chunks: task() }, ...Array.from({ length: EXPLORE_MAX_STEPS }, (_, i) => read(i)), { chunks: textChunks('done') });
    const h = harness();
    const r = await runAgentTurn(makeInit(), h.io, new AbortController().signal, fast);
    expect(r.exitCode).toBe(0);
    const result = h.events.find((e) => e.type === 'tool.result' && e.payload['id'] === 't1')!;
    expect(String(result.payload['content'])).toContain(`stopped after ${EXPLORE_MAX_STEPS} steps`);
    expect(mock.requests).toHaveLength(1 + EXPLORE_MAX_STEPS + 1);
  });

  it('is cancelled with its parent: the task call gets the interrupted result and the history stays valid', async () => {
    mock.script({ chunks: task() }, { stall: true });
    const ac = new AbortController();
    const h = harness();
    const p = runAgentTurn(makeInit(), h.io, ac.signal, fast);
    while (mock.requests.length < 2) await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    const r = await p;
    expect(r.exitCode).toBe(143);
    const s = Session.open({ path: join(dir, 's.jsonl'), id: 'x', cwd: dir });
    const last = s.messages.at(-1)!;
    expect(last).toMatchObject({ role: 'toolResult', toolCallId: 't1', isError: true });
    s.close();
  });
});
