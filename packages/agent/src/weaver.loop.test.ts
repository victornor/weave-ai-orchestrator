import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compactionThreshold } from './compaction.js';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { Session } from './session.js';
import { SteeringQueue } from './steering.js';
import { startMockMcp, type MockMcp } from './testkit/mockMcp.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';
import { messagesTokens, TOKEN_MARGIN, toolsTokens } from './tokens.js';
import type { Message } from './types.js';

/** The weaver's run-scoped MCP server exposes about 40 `weave_*` tools; these are their names. */
const WEAVE_TOOLS = ['weave_human_send', 'weave_ticket_get', 'weave_ticket_list', 'weave_ticket_create', 'weave_ticket_comment', 'weave_ticket_comments', 'weave_ticket_transition', 'weave_inbox', 'weave_report', 'weave_ask',
  'weave_knowledge_get', 'weave_knowledge_note', 'weave_knowledge_docs', 'weave_knowledge_doc_get', 'weave_knowledge_doc_put', 'weave_knowledge_search', 'weave_roadmap_list', 'weave_spec_get', 'weave_spec_list', 'weave_spec_search',
  'weave_worktree_status', 'weave_schedule_wakeup', 'weave_incident', 'weave_openspec_status', 'weave_project_list', 'weave_role_list', 'weave_role_get', 'weave_role_set_secrets', 'weave_worker_list', 'weave_worker_get',
  'weave_plan_get', 'weave_plan_put', 'weave_decision_list', 'weave_decision_get', 'weave_usage_get', 'weave_thread_list', 'weave_thread_get', 'weave_artifact_kit', 'weave_ticket_artifact_put', 'weave_ticket_work_product'];
const DESCRIPTION = 'Does this weaver operation against the workspace: reads or writes the named object, honours the run token, and returns the result as text. Use it instead of guessing what the workspace holds.';

let dir: string; let mock: MockProvider; let mcp: MockMcp | undefined;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-weaver-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); await mcp?.close(); mcp = undefined; rmSync(dir, { recursive: true, force: true }); });
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
const harness = (): { io: LoopIO; events: ChildEvent[] } => { const events: ChildEvent[] = []; return { events, io: { emit: (e) => events.push(e), partial: () => undefined, log: () => undefined } }; };
const msgs = (i: number): Array<{ role: string; content?: unknown; tool_calls?: unknown }> => mock.requests[i]!.body['messages'] as Array<{ role: string; content?: unknown; tool_calls?: unknown }>;
const LAST_HUMAN = 'LAST HUMAN MESSAGE: tell captain the deploy is finished';

function init(over: { prompt?: string; window: number; withMcp: boolean }): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-weaver', turnEpoch: 1, cwd: dir, worktree: null, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: 'mock-model', options: { contextWindowTokens: over.window }, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k' },
    prompt: over.prompt ?? 'continue', systemPrompt: { text: 'You are the weaver.', mode: 'inject' },
    session: { path: join(dir, 'weaver.jsonl'), id: 'weaver-1' },
    mcpServers: over.withMcp && mcp ? { 'weave-ai': { url: mcp.url, headers: { Authorization: 'Bearer run-token' } } } : {},
    toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}

/** A weaver-like history: `count` messages of human turns, `weave_*` calls and their results, ending on the last human message and a reply. */
function seed(count: number, wordsPerMessage: number): void {
  const s = Session.open({ path: join(dir, 'weaver.jsonl'), id: 'weaver-1', cwd: dir });
  const words = (i: number): string => Array.from({ length: wordsPerMessage }, (_, k) => `w${(k * 13 + i) % 700}`).join(' ');
  let i = 0; let call = 0;
  while (s.messages.length < count - 2) {
    if (i % 5 === 0) s.append({ role: 'user', text: `human ${i}: ${words(i)}` });
    else if (i % 5 === 1 || i % 5 === 3) { const id = `w${call++}`; s.append({ role: 'assistant', content: [{ type: 'toolCall', id, name: WEAVE_TOOLS[call % WEAVE_TOOLS.length]!, args: { id: `T-${i}` } }] }); s.append({ role: 'toolResult', toolCallId: id, name: WEAVE_TOOLS[call % WEAVE_TOOLS.length]!, text: `result ${i}: ${words(i)}`, isError: false }); i++; }
    else s.append({ role: 'assistant', content: [{ type: 'text', text: `reply ${i}: ${words(i)}` }] });
    i++;
  }
  s.append({ role: 'user', text: LAST_HUMAN });
  s.append({ role: 'assistant', content: [{ type: 'text', text: 'On it.' }] });
  s.close();
}
const historyTokens = (): number => { const s = Session.open({ path: join(dir, 'weaver.jsonl'), id: 'weaver-1', cwd: dir }); const n = messagesTokens(s.context()); s.close(); return n; };


async function startWeaverMcp(sent: Array<Record<string, unknown>> = []): Promise<MockMcp> {
  return startMockMcp(WEAVE_TOOLS.map((name) => ({ name, description: DESCRIPTION })), (name, args) => { if (name === 'weave_human_send') sent.push(args); return name === 'weave_human_send' ? 'sent to captain' : 'ok'; });
}
const WINDOW = 60_000;
/** What the ~40 weave_* schemas plus the core tools cost, measured from a real request. */
async function probeToolCost(): Promise<number> {
  seed(4, 10);
  mock.script({ chunks: textChunks('hello') });
  await runAgentTurn(init({ window: 1_000_000, withMcp: true }), harness().io, new AbortController().signal, fast);
  const offered = (mock.requests[0]!.body['tools'] as Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>).map((t) => t.function);
  expect(offered.filter((t) => t.name.startsWith('weave_'))).toHaveLength(WEAVE_TOOLS.length);
  mock.requests.length = 0;
  rmSync(join(dir, 'weaver.jsonl'));
  return toolsTokens(offered);
}
/** A 520 message history whose messages alone stay under the trigger but cross it once the schemas are counted. */
function seedNearTrigger(toolCost: number): void {
  const threshold = compactionThreshold(WINDOW, undefined);
  const target = Math.floor(threshold / TOKEN_MARGIN - toolCost * 0.6);
  let words = 40;
  for (let round = 0; round < 6; round++) {
    rmSync(join(dir, 'weaver.jsonl'), { force: true });
    seed(520, words);
    const t = historyTokens();
    if (Math.abs(t - target) / target < 0.03) break;
    words = Math.max(2, Math.round(words * (target / t)));
  }
  const s0 = Session.open({ path: join(dir, 'weaver.jsonl'), id: 'weaver-1', cwd: dir });
  expect(s0.messages.length).toBeGreaterThanOrEqual(500);
  s0.close();
  expect(historyTokens() * TOKEN_MARGIN).toBeLessThan(threshold);
}

describe('at the weaver\'s scale', () => {
  it('counts the ~40 weave_* schemas in the window budget, compacts a 500+ message history, keeps the last human message, and a weave_human_send turn works end to end', async () => {
    const sent: Array<Record<string, unknown>> = [];
    mcp = await startWeaverMcp(sent);
    expect(WEAVE_TOOLS.length).toBeGreaterThanOrEqual(40);
    // 1. Probe: the tools the model is offered, to measure what they cost.

    const toolCost = await probeToolCost();
    expect(toolCost).toBeGreaterThan(3000);
    // 2. A window whose trigger the messages alone stay under, but messages plus schemas cross.
    seedNearTrigger(toolCost);
    const window = WINDOW;

    // 3. The turn: summary, then a weave_human_send call, then the final text.
    mock.script(
      { chunks: textChunks('## Goal\nRun the workspace; the human asked to be told the deploy finished.') },
      { chunks: toolCallChunks([{ id: 'h1', name: 'weave_human_send', args: '{"message":"The deploy is finished."}' }]) },
      { chunks: textChunks('Told captain.') },
    );
    const h = harness();
    const r = await runAgentTurn(init({ prompt: 'Any update for captain?', window, withMcp: true }), h.io, new AbortController().signal, fast);

    expect(r).toMatchObject({ exitCode: 0, finalText: 'Told captain.' });
    expect(h.events.find((e) => e.type === 'session.compaction.completed')!.payload).toMatchObject({ ok: true, trigger: 'proactive' });
    // the summary request itself carries no tools; the next request starts with the summary
    expect(mock.requests[0]!.body['tools']).toBeUndefined();
    const second = msgs(1);
    expect(String(second[1]!.content)).toMatch(/^\[Conversation summary\]\n## Goal/);
    expect(second.length).toBeLessThan(530);
    // the last human message survives compaction, verbatim
    expect(JSON.stringify(second)).toContain(LAST_HUMAN);
    expect(JSON.stringify(second)).toContain('Any update for captain?');
    // the weaver's full tool set is still offered after compaction
    expect((mock.requests[1]!.body['tools'] as unknown[]).length).toBeGreaterThanOrEqual(WEAVE_TOOLS.length);

    // weave_human_send reached the loopback MCP with the run token and its result went back to the model
    expect(sent).toEqual([{ message: 'The deploy is finished.' }]);
    expect(mcp.calls.find((c) => c.name === 'weave_human_send')!.headers['authorization']).toBe('Bearer run-token');
    expect(msgs(2).filter((m) => m.role === 'tool').map((m) => String(m.content))).toContain('sent to captain');

    // 4. The compacted session resumes and continues.
    mock.script({ chunks: textChunks('Anything else?') });
    const r2 = await runAgentTurn(init({ prompt: 'Thanks', window, withMcp: true }), harness().io, new AbortController().signal, fast);
    expect(r2.exitCode).toBe(0);
    expect(String(msgs(3)[1]!.content)).toMatch(/^\[Conversation summary\]/);
    expect(JSON.stringify(msgs(3))).toContain('Thanks');
  });

  it('the same history is left alone without the tool schemas and compacts with them: the schemas are in the budget', async () => {
    mcp = await startWeaverMcp();
    const toolCost = await probeToolCost();
    seedNearTrigger(toolCost);
    const saved = readFileSync(join(dir, 'weaver.jsonl'));
    mock.script({ chunks: textChunks('fine') });
    const without = harness();
    await runAgentTurn(init({ window: WINDOW, withMcp: false }), without.io, new AbortController().signal, fast);
    expect(without.events.some((e) => e.type === 'session.compaction.started')).toBe(false);
    expect(mock.requests).toHaveLength(1);

    writeFileSync(join(dir, 'weaver.jsonl'), saved);
    mock.requests.length = 0;
    mock.script({ chunks: textChunks('## Goal\nsummary') }, { chunks: textChunks('fine') });
    const withTools = harness();
    await runAgentTurn(init({ window: WINDOW, withMcp: true }), withTools.io, new AbortController().signal, fast);
    expect(withTools.events.some((e) => e.type === 'session.compaction.completed')).toBe(true);
  });
});

describe('a weaver turn with live input', () => {
  it('answers a human message sent while it runs, in the same turn, with a valid history', async () => {
    const q = new SteeringQueue();
    let pushed = false;
    const h = harness();
    const io: LoopIO = { ...h.io, emit: (e) => { h.events.push(e); if (e.type === 'assistant.text' && !pushed) { pushed = true; q.push('Actually, tell captain the deploy is finished.'); } } };
    mock.script({ chunks: textChunks('Working on the workspace.') }, { chunks: textChunks('Told captain the deploy is finished.') });
    const r = await runAgentTurn(init({ window: WINDOW, withMcp: false }), io, new AbortController().signal, { ...fast, steering: q });
    expect(r.finalText).toBe('Told captain the deploy is finished.');
    expect(mock.requests).toHaveLength(2);
    const second = msgs(1);
    const resultAt = second.findIndex((m) => m.role === 'tool');
    const humanAt = second.findIndex((m) => m.role === 'user' && String(m.content).includes('tell captain the deploy is finished'));
    expect(humanAt).toBeGreaterThanOrEqual(0);
    expect(resultAt === -1 || humanAt > resultAt).toBe(true);
    // The history is still valid after the injected message.
    const s = Session.open({ path: join(dir, 'weaver.jsonl'), id: 'weaver-1', cwd: dir });
    for (let i = 0; i < s.messages.length; i++) {
      const cur = s.messages[i]!;
      if (cur.role !== 'assistant') continue;
      const ids = cur.content.filter((b) => b.type === 'toolCall').map((b) => (b as { id: string }).id);
      expect(s.messages.slice(i + 1, i + 1 + ids.length).map((x) => (x.role === 'toolResult' ? x.toolCallId : null))).toEqual(ids);
    }
    s.close();
  });
});
