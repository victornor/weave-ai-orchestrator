/**
 * VS-653: a worker turn on the built-in agent must offer the ticket, report and ask tools its
 * prompt names, and `submit_result`. The mock provider and a mock Weave MCP server stand in for the
 * real ones; nothing here reaches a live provider.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMON_TOOLS, RUN_REPORT_JSON_SCHEMA, WORKER_ONLY_TOOLS } from '@weave-ai/shared';
import { runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { startMockMcp, type MockMcp } from './testkit/mockMcp.js';
import { startMockProvider, textChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider; let mcp: MockMcp | undefined;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-w653-')); mkdirSync(join(dir, 'wt')); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); await mcp?.close(); mcp = undefined; rmSync(dir, { recursive: true, force: true }); });

const WORKER_TOOLS = [...COMMON_TOOLS, ...WORKER_ONLY_TOOLS];
function init(over: { mode?: 'inject' | 'skip'; servers?: InitMessage['mcpServers'] } = {}): InitMessage {
  return {
    type: 'init', v: 1,
    run: { runId: 'run-w', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000 }, permission: { mode: 'auto' }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
    provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k' },
    prompt: 'go', systemPrompt: { text: 'You are a worker.', mode: over.mode ?? 'inject' },
    outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>,
    session: { path: join(dir, 's.jsonl'), id: 'sess' }, mcpServers: over.servers ?? { 'weave-ai': { type: 'http', url: mcp!.url } }, toolEnv: { PATH: process.env['PATH'] ?? '' },
  };
}
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
function harness(): { io: LoopIO; events: ChildEvent[] } {
  const events: ChildEvent[] = [];
  return { events, io: { emit: (e) => { events.push(e); }, partial: () => undefined, log: () => undefined } };
}
const offered = (i: number): string[] => ((mock.requests[i]!.body['tools'] as Array<{ function: { name: string } }> | undefined) ?? []).map((t) => t.function.name);

describe('a worker turn offers the tools its prompt names', () => {
  it('sends the ticket, report and ask tools and submit_result in the request', async () => {
    mcp = await startMockMcp(WORKER_TOOLS.map((name) => ({ name })), () => 'ok');
    mock.script({ chunks: textChunks('done') });
    await runAgentTurn(init(), harness().io, new AbortController().signal, { ...fast });
    const names = offered(0);
    for (const t of ['weave_inbox', 'weave_ticket_get', 'weave_report', 'weave_ask', 'weave_ticket_transition', 'submit_result']) expect(names).toContain(t);
  });

  it('does the same on a resumed session', async () => {
    mcp = await startMockMcp(WORKER_TOOLS.map((name) => ({ name })), () => 'ok');
    mock.script({ chunks: textChunks('one') }, { chunks: textChunks('two') }, { chunks: textChunks('three') }, { chunks: textChunks('four') });
    await runAgentTurn(init(), harness().io, new AbortController().signal, { ...fast });
    await runAgentTurn(init({ mode: 'skip' }), harness().io, new AbortController().signal, { ...fast });
    const last = mock.requests.length - 1;
    expect(offered(last)).toContain('weave_report');
    expect(offered(last)).toContain('submit_result');
  });
});

describe('tool surface reporting and the start guard', () => {
  it('records the offered tools on the run', async () => {
    mcp = await startMockMcp(WORKER_TOOLS.map((name) => ({ name })), () => 'ok');
    mock.script({ chunks: textChunks('done') });
    const h = harness();
    await runAgentTurn(init(), h.io, new AbortController().signal, { ...fast });
    const ev = h.events.find((e) => e.type === 'tools.offered')!;
    expect(ev.payload['names']).toEqual(expect.arrayContaining(['weave_report', 'weave_ask', 'submit_result']));
    expect(ev.payload['submitResult']).toBe(true);
    expect(ev.payload['weaveServerTools']).toBe(WORKER_TOOLS.length);
  });

  it('refuses to start when the Weave server lists no tools', async () => {
    mcp = await startMockMcp([], () => 'ok');
    const h = harness();
    const r = await runAgentTurn(init(), h.io, new AbortController().signal, { ...fast });
    expect(r.error?.code).toBe('tools_missing');
    expect(r.error?.family).toBe('tooling');
    expect(mock.requests).toHaveLength(0);
  });
});
