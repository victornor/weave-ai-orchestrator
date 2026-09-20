import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimateTokens } from './tokens.js';
import { PREAMBLE, runAgentTurn, type LoopDeps, type LoopIO } from './loop.js';
import type { ChildEvent, InitMessage } from './protocol.js';
import { skillIndex, loadSkills } from './skills.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from './testkit/mockProvider.js';

let dir: string; let mock: MockProvider;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-ctx-')); mkdirSync(join(dir, 'wt', 'sub'), { recursive: true }); mock = await startMockProvider(); });
afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });
const fast: LoopDeps = { sleep: async () => undefined, partialFlushMs: 1 };
const init = (over: { mode?: 'auto' | 'restricted'; systemText?: string } = {}): InitMessage => ({
  type: 'init', v: 1,
  run: { runId: 'run-abc123', turnEpoch: 1, cwd: dir, worktree: { path: join(dir, 'wt'), branch: 'ac/x' }, limits: { timeoutMs: 600_000 }, permission: { mode: over.mode ?? 'auto' }, model: 'mock-model', options: {}, spillDir: join(dir, 'spill') },
  provider: { id: 'mock', baseUrl: mock.baseUrl, auth: 'bearer', headers: {}, apiKey: 'k' },
  prompt: 'go', systemPrompt: { text: over.systemText ?? 'HOME INSTRUCTIONS', mode: 'inject' },
  session: { path: join(dir, 's.jsonl'), id: 'sess1' }, mcpServers: {}, toolEnv: { PATH: process.env['PATH'] ?? '' },
});
const io = (): { io: LoopIO; events: ChildEvent[] } => { const events: ChildEvent[] = []; return { events, io: { emit: (e) => events.push(e), partial: () => undefined, log: () => undefined } }; };
const msgs = (i: number): Array<{ role: string; content?: unknown }> => mock.requests[i]!.body['messages'] as Array<{ role: string; content?: unknown }>;

describe('instructions', () => {
  it('appends a directory\'s AGENTS.md to its first read only', async () => {
    writeFileSync(join(dir, 'wt', 'sub', 'AGENTS.md'), 'SUB RULES: use tabs');
    writeFileSync(join(dir, 'wt', 'sub', 'a.txt'), 'alpha\n'); writeFileSync(join(dir, 'wt', 'sub', 'b.txt'), 'beta\n');
    mock.script(
      { chunks: toolCallChunks([{ id: 'c1', name: 'read', args: '{"path":"sub/a.txt"}' }]) },
      { chunks: toolCallChunks([{ id: 'c2', name: 'read', args: '{"path":"sub/b.txt"}' }]) },
      { chunks: textChunks('done') },
    );
    await runAgentTurn(init(), io().io, new AbortController().signal, fast);
    const last = msgs(2).filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(last[0]).toContain(`[instructions from ${join(dir, 'wt', 'sub', 'AGENTS.md')}]\nSUB RULES: use tabs`);
    expect(last[1]).not.toContain('SUB RULES');
  });
});

describe('skills', () => {
  it('lists skills in the system prompt and returns a body through the skill tool, also in restricted mode', async () => {
    const d = join(dir, '.agents', 'skills', 'deploy'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), '---\nname: deploy\ndescription: How to ship a release\n---\n\nSTEP ONE: tag it\n');
    mock.script({ chunks: toolCallChunks([{ id: 's1', name: 'skill', args: '{"name":"deploy"}' }]) }, { chunks: textChunks('ok') });
    const h = io();
    await runAgentTurn(init({ mode: 'restricted' }), h.io, new AbortController().signal, fast);
    expect(String(msgs(0)[0]!.content)).toContain('- deploy: How to ship a release');
    expect((mock.requests[0]!.body['tools'] as Array<{ function: { name: string } }>).map((t) => t.function.name)).toContain('skill');
    const result = msgs(1).filter((m) => m.role === 'tool').map((m) => String(m.content)).join('');
    expect(result).toContain('STEP ONE: tag it');
    expect(result).toContain(`Directory: ${d}`);
  });
});

describe('the system prompt', () => {
  it('is at most 1200 tokens without the home instructions and skill index', () => {
    expect(estimateTokens(PREAMBLE)).toBeLessThanOrEqual(1200);
  });
  it('is byte-identical across every request of a turn, and the date and paths stay out of it', async () => {
    writeFileSync(join(dir, 'wt', 'a.txt'), 'alpha\n');
    mock.script({ chunks: toolCallChunks([{ id: 'c1', name: 'read', args: '{"path":"a.txt"}' }]) }, { chunks: toolCallChunks([{ id: 'c2', name: 'read', args: '{"path":"a.txt"}' }]) }, { chunks: textChunks('done') });
    await runAgentTurn(init(), io().io, new AbortController().signal, fast);
    const systems = [0, 1, 2].map((i) => JSON.stringify(msgs(i)[0]));
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toContain('HOME INSTRUCTIONS');
    expect(systems[0]).not.toContain(new Date().toISOString().slice(0, 10));
    expect(systems[0]).not.toContain(dir);
    expect(skillIndex(loadSkills(dir))).toBe('');
  });
});
