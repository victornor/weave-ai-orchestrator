/**
 * S7: live input while a turn runs, `submit_result` structured output, and `todo_write`.
 * The mock provider is the only endpoint used here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUN_REPORT_JSON_SCHEMA } from '@weave-ai/shared';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { SteeringQueue } from './steering.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-s7-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

function init(over: { outputSchema?: Record<string, unknown>; mode?: 'auto' | 'restricted' } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-s7', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000 }, permission: { mode: over.mode ?? 'auto' }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k' },
    prompt: 'go', systemPrompt: { text: '', mode: 'skip' },
    ...(over.outputSchema ? { outputSchema: over.outputSchema } : {}),
    session: { path: join(dir, 's.jsonl'), id: 'sess' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
function harness(onEvent?: (e: ChildEvent) => void): { io: LoopIO; events: ChildEvent[]; types: () => string[] } {
  const events: ChildEvent[] = [];
  return { events, types: () => events.map((e) => e.type), io: { emit: (e) => { events.push(e); onEvent?.(e); }, partial: () => undefined, log: () => undefined } };
}
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
const body = (i: number): Record<string, unknown> => mock.requests[i]!.body;
const messages = (i: number): Array<Record<string, unknown>> => body(i)['messages'] as Array<Record<string, unknown>>;
const report = { state: 'working', summary: 'did it', tickets: [], nextAction: null, knowledge: { recorded: false, where: null, reason: 'none' }, uncommittedWork: false };

describe('live input', () => {
  it('delivers a mid-turn message in the next request, after the tool results', async () => {
    writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\n');
    mock.script({ chunks: toolCallChunks([{ id: 'r1', name: 'read', args: '{"path":"a.txt"}' }]) }, { chunks: textChunks('answered') });
    const q = new SteeringQueue();
    const h = harness((e) => { if (e.type === 'tool.call') q.push('also read b.txt'); });
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, { ...fast, steering: q });
    expect(r.finalText).toBe('answered');
    expect(mock.requests).toHaveLength(2);
    const msgs = messages(1);
    const resultAt = msgs.findIndex((m) => m['role'] === 'tool');
    const steerAt = msgs.findIndex((m) => m['role'] === 'user' && m['content'] === 'also read b.txt');
    expect(resultAt).toBeGreaterThanOrEqual(0);
    expect(steerAt).toBeGreaterThan(resultAt);
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('keeps the turn going when the step produced no tool calls and input is queued', async () => {
    mock.script({ chunks: textChunks('first thought') }, { chunks: textChunks('after steering') });
    const q = new SteeringQueue();
    let pushed = false;
    const h = harness((e) => { if (e.type === 'assistant.text' && !pushed) { pushed = true; q.push('steer now'); } });
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, { ...fast, steering: q });
    expect(r.finalText).toBe('after steering');
    expect(mock.requests).toHaveLength(2);
    expect(messages(1).some((m) => m['role'] === 'user' && m['content'] === 'steer now')).toBe(true);
    assertValidHistory(join(dir, 's.jsonl'));
  });
});

describe('structured output', () => {
  it('ends the turn with the submitted report and offers submit_result in restricted mode', async () => {
    mock.script({ chunks: toolCallChunks([{ id: 's1', name: 'submit_result', args: JSON.stringify(report) }]) });
    const h = harness();
    const r = await runAgentTurn(init({ outputSchema: RUN_REPORT_JSON_SCHEMA, mode: 'restricted' }), h.io, new AbortController().signal, fast);
    expect(r).toMatchObject({ exitCode: 0, structured: report });
    expect(mock.requests).toHaveLength(1);
    expect((body(0)['tools'] as Array<{ function: { name: string } }>).map((t) => t.function.name)).toContain('submit_result');
    expect(h.events.find((e) => e.type === 'tool.result')!.payload).toMatchObject({ name: 'submit_result', isError: false });
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('corrects invalid arguments twice, then fails the turn tool_call_invalid', async () => {
    const bad = '{"state":"nope"}';
    mock.script(
      { chunks: toolCallChunks([{ id: 's1', name: 'submit_result', args: bad }]) },
      { chunks: toolCallChunks([{ id: 's2', name: 'submit_result', args: bad }]) },
      { chunks: toolCallChunks([{ id: 's3', name: 'submit_result', args: bad }]) },
    );
    const h = harness();
    const r = await runAgentTurn(init({ outputSchema: RUN_REPORT_JSON_SCHEMA }), h.io, new AbortController().signal, fast);
    expect(r.error).toMatchObject({ code: 'tool_call_invalid', family: 'tooling' });
    const results = h.events.filter((e) => e.type === 'tool.result');
    expect(results).toHaveLength(2);
    for (const res of results) {
      expect(res.payload['isError']).toBe(true);
      expect(String(res.payload['content'])).toContain("does not match the run's schema");
    }
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('nudges a model that stops without submitting, at most twice', async () => {
    mock.script({ chunks: textChunks('thinking') }, { chunks: textChunks('still thinking') }, { chunks: toolCallChunks([{ id: 's1', name: 'submit_result', args: JSON.stringify(report) }]) });
    const h = harness();
    const r = await runAgentTurn(init({ outputSchema: RUN_REPORT_JSON_SCHEMA }), h.io, new AbortController().signal, fast);
    expect(r.structured).toEqual(report);
    expect(mock.requests).toHaveLength(3);
    expect(JSON.stringify(body(1))).toContain('submit_result');
    assertValidHistory(join(dir, 's.jsonl'));
  });

  it('stops after two nudges and keeps the text when the model never submits', async () => {
    mock.script({ chunks: textChunks('one') }, { chunks: textChunks('two') }, { chunks: textChunks('three') });
    const h = harness();
    const r = await runAgentTurn(init({ outputSchema: RUN_REPORT_JSON_SCHEMA }), h.io, new AbortController().signal, fast);
    expect(r.structured).toBeUndefined();
    expect(r.finalText).toBe('three');
    expect(mock.requests).toHaveLength(3);
  });

  it('offers no submit_result and never nudges a turn that carries no schema (a raw ticketless session)', async () => {
    mock.script({ chunks: textChunks('just talking') });
    const h = harness();
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, fast);
    expect(r.structured).toBeUndefined();
    expect(r.finalText).toBe('just talking');
    expect(mock.requests).toHaveLength(1);
    expect((body(0)['tools'] as Array<{ function: { name: string } }>).map((t) => t.function.name)).not.toContain('submit_result');
  });
});

describe('todo_write', () => {
  it('replaces the list and emits a plan.proposed event carrying the items', async () => {
    mock.script(
      { chunks: toolCallChunks([{ id: 't1', name: 'todo_write', args: JSON.stringify({ todos: [{ content: 'a', status: 'pending' }] }) }]) },
      { chunks: toolCallChunks([{ id: 't2', name: 'todo_write', args: JSON.stringify({ todos: [{ content: 'b', status: 'completed' }, { content: 'c', status: 'in_progress' }] }) }]) },
      { chunks: textChunks('done') },
    );
    const h = harness();
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, fast);
    expect(r.finalText).toBe('done');
    const plans = h.events.filter((e) => e.type === 'plan.proposed');
    expect(plans).toHaveLength(2);
    expect(plans[0]!.payload).toMatchObject({ id: 't1', items: [{ content: 'a', status: 'pending' }] });
    expect(plans[1]!.payload).toMatchObject({ id: 't2', items: [{ content: 'b', status: 'completed' }, { content: 'c', status: 'in_progress' }] });
    const results = h.events.filter((e) => e.type === 'tool.result').map((e) => String(e.payload['content']));
    expect(results[0]).toContain('1 item(s)');
    expect(results[1]).toContain('2 item(s)');
    assertValidHistory(join(dir, 's.jsonl'));
  });
});
