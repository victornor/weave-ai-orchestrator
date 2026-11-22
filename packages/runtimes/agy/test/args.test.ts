import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { readFileSync } from 'node:fs';
import { buildArgs, FAMILIES, MAX_ARGV_PROMPT, mcpConfigJson, resumeCommand, variantIds } from '../src/index.js';

const base = (over: Partial<TurnInput> = {}): TurnInput => ({
  runId: 'r1', turnEpoch: 1, cwd: '/w/01ABC', worktree: null,
  session: { policy: 'resume', ref: null, isFirstTurn: true },
  systemPrompt: { text: '', mode: 'skip' }, prompt: 'do it',
  mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7433/mcp', headers: { Authorization: 'Bearer t' } } },
  env: {}, options: {}, limits: { timeoutMs: 1000 }, permission: { mode: 'bypass' },
  ...over,
});

describe('agy buildArgs (VS-995)', () => {
  it('runs every turn under the agent\'s own absolute --gemini_dir, before anything else', () => {
    const b = buildArgs(base());
    expect(b.args.slice(0, 4)).toEqual(['--gemini_dir', '/w/01ABC/.agy', '-p', 'do it']);
    expect(b.args).toContain('stream-json');
    expect(b.args).not.toContain('--conversation');
    expect(b.files[0]!.path).toBe('/w/01ABC/.agy/config/mcp_config.json');
  });

  it('writes exactly the run\'s MCP servers', () => {
    const b = buildArgs(base({ mcpServers: { 'weave-ai': { type: 'http', url: 'http://h/mcp' }, tool: { type: 'stdio', command: 'node', args: ['s.js'], env: { A: '1' } } } }));
    expect(JSON.parse(b.files[0]!.content)).toEqual({ mcpServers: {
      'weave-ai': { url: 'http://h/mcp' },
      tool: { command: 'node', args: ['s.js'], env: { A: '1' } },
    } });
    expect(JSON.parse(mcpConfigJson({}))).toEqual({ mcpServers: {} });
  });

  it('passes the report schema and resumes by conversation id', () => {
    const schema = { type: 'object', properties: {} };
    const b = buildArgs(base({ outputSchema: schema, session: { policy: 'resume', ref: { conversationId: 'c-123' }, isFirstTurn: false } }));
    expect(b.args[b.args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(b.args[b.args.indexOf('--conversation') + 1]).toBe('c-123');
    expect(b.args.slice(0, 2)).toEqual(['--gemini_dir', '/w/01ABC/.agy']);
    expect(b.resumed).toBe(true);
  });

  it.each([
    ['gemini-4-neon', 'high', 'gemini-4-neon-high'],
    ['claude-opus-5-5', 'high', 'claude-opus-5-5-high'],
    ['gemini-4-neon-high', 'low', 'gemini-4-neon-high'],
  ])('sends model %s at effort %s as --model %s and never --effort', (model, effort, expected) => {
    const b = buildArgs(base({ model, effort }));
    expect(b.args[b.args.indexOf('--model') + 1]).toBe(expected);
    expect(b.args).not.toContain('--effort');
  });

  it.each([
    ['bypass', ['--dangerously-skip-permissions']],
    ['auto', ['--mode', 'accept-edits']],
    ['restricted', ['--mode', 'plan']],
  ] as const)('maps permission %s', (mode, flags) => {
    const b = buildArgs(base({ permission: { mode } }));
    const i = b.args.indexOf(flags[0]);
    expect(b.args.slice(i, i + flags.length)).toEqual([...flags]);
  });

  it('adds an out-of-home worktree and puts an over-long prompt in a file the -p value points at', () => {
    // agy 1.5.14 rejects a valueless `-p` with the prompt on stdin (captured), so a file it is.
    expect(readFileSync(new URL('../fixtures/valueless-p.stderr.txt', import.meta.url), 'utf8')).toContain('flag needs an argument: -p');
    const long = 'é'.repeat(MAX_ARGV_PROMPT / 2 + 1); // over the limit in bytes, under it in characters
    const b = buildArgs(base({ prompt: long, worktree: { path: '/repo/wt', branch: 'b' } }));
    expect(b.args[b.args.indexOf('--add-dir') + 1]).toBe('/repo/wt');
    expect(b.stdin).toBeNull();
    const file = b.files.find((f) => f.path === '/w/01ABC/.agy/prompts/r1.md');
    expect(file?.content).toBe(long);
    expect(b.args[b.args.indexOf('-p') + 1]).toContain('/w/01ABC/.agy/prompts/r1.md');
    expect(b.args.join(' ')).not.toContain(long);
  });

  it('never sends --model with --effort, which agy refuses outright', () => {
    // The captured refusal: a variant id plus a conflicting --effort fails before the model is reached.
    expect(readFileSync(new URL('../fixtures/model-effort-conflict.stderr.txt', import.meta.url), 'utf8'))
      .toContain('--model gemini-4-neon-high conflicts with --effort=low');
    const models = [...FAMILIES.map((f) => f.id), ...variantIds(), 'some-future-model'];
    for (const model of models) {
      for (const effort of [null, 'low', 'medium', 'high', 'xhigh', 'max']) {
        for (const viaOptions of [false, true]) {
          const b = buildArgs(base(viaOptions ? { options: { model, effort } } : { model, effort }));
          expect(b.args).not.toContain('--effort');
          expect(b.args.filter((a) => a === '--model')).toHaveLength(1);
        }
      }
    }
  });

  it('builds the interactive resume with the same dir and conversation', () => {
    expect(resumeCommand({ cwd: '/w/01ABC', worktreePath: null, session: { conversationId: 'c-9' } }).args)
      .toEqual(['--gemini_dir', '/w/01ABC/.agy', '--conversation', 'c-9']);
  });
});
