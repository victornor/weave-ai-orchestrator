import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { buildArgs, MAX_ARGV_PROMPT, mcpConfigJson, resumeCommand } from '../src/index.js';

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

  it('adds an out-of-home worktree and puts an over-long prompt on stdin behind a trailing -p', () => {
    const long = 'x'.repeat(MAX_ARGV_PROMPT + 1);
    const b = buildArgs(base({ prompt: long, worktree: { path: '/repo/wt', branch: 'b' } }));
    expect(b.args[b.args.indexOf('--add-dir') + 1]).toBe('/repo/wt');
    expect(b.stdin).toBe(long);
    expect(b.args.at(-1)).toBe('-p');
    expect(b.args.join(' ')).not.toContain(long);
  });

  it('builds the interactive resume with the same dir and conversation', () => {
    expect(resumeCommand({ cwd: '/w/01ABC', worktreePath: null, session: { conversationId: 'c-9' } }).args)
      .toEqual(['--gemini_dir', '/w/01ABC/.agy', '--conversation', 'c-9']);
  });
});
