import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@agent-conductor/runtime-sdk';
import { buildArgs, MAX_ARGV_PROMPT, userFrame } from '../src/args.js';

function input(over: Partial<TurnInput> = {}): TurnInput {
  return {
    runId: 'run-1', turnEpoch: 1, cwd: '/home/agent', worktree: null,
    session: { policy: 'per_ticket', ref: null, isFirstTurn: true },
    systemPrompt: { text: 'charter', mode: 'inject' },
    prompt: 'do the thing', mcpServers: {}, env: {}, options: {},
    limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' },
    ...over,
  };
}
const s = (a: string[]) => a.join(' ');

describe('cursor buildArgs — live input (default)', () => {
  it('builds print-mode stream-json with the prompt as the first user frame', () => {
    const b = buildArgs(input());
    expect(b.cmd).toBe('cursor-agent');
    expect(s(b.args)).toContain('-p --output-format stream-json --trust');
    expect(s(b.args)).toContain('--force');
    expect(s(b.args)).toContain('--sandbox disabled');
    expect(b.args).not.toContain('do the thing');
    expect(b.stdin).toBe(userFrame('do the thing'));
    expect(JSON.parse(b.stdin!.trimEnd())).toEqual({ type: 'user', message: { role: 'user', content: 'do the thing' } });
    expect(b.liveInput).toBe(true);
    expect(b.resumed).toBe(false);
  });

  it('does not prefix the frame with & and never passes acp, worker, --continue or --worktree', () => {
    const b = buildArgs(input());
    expect(b.stdin!.startsWith('&')).toBe(false);
    expect(b.args).not.toContain('acp');
    expect(b.args).not.toContain('worker');
    expect(b.args).not.toContain('--continue');
    expect(b.args).not.toContain('--worktree');
    expect(b.args).not.toContain('-w');
    expect(b.args).not.toContain('--worktree-base');
    expect(s(b.args)).not.toContain('cursor.com/agents');
  });

  it('resumes a stored session and never uses --continue', () => {
    const b = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'chat-9' }, isFirstTurn: false } }));
    expect(s(b.args)).toContain('--resume chat-9');
    expect(b.args).not.toContain('--continue');
    expect(b.resumed).toBe(true);
    expect(b.sessionId).toBe('chat-9');
  });

  it('maps permission postures onto sandbox and force', () => {
    expect(s(buildArgs(input({ permission: { mode: 'bypass' } })).args)).toContain('--yolo');
    const r = buildArgs(input({ permission: { mode: 'restricted' } }));
    expect(s(r.args)).toContain('--sandbox enabled');
    expect(r.args).not.toContain('--force');
    expect(r.args).not.toContain('--yolo');
  });

  it('writes MCP servers into .cursor/mcp.json and passes --approve-mcps', () => {
    const b = buildArgs(input({
      mcpServers: { agentconductor: { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } } },
    }));
    expect(b.args).toContain('--approve-mcps');
    const f = b.files.find((x) => x.path === '/home/agent/.cursor/mcp.json')!;
    expect(JSON.parse(f.content).mcpServers.agentconductor).toEqual({
      url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' },
    });
  });

  it('writes no mcp file when there are no servers', () => {
    expect(buildArgs(input()).files).toHaveLength(0);
    expect(buildArgs(input()).args).not.toContain('--approve-mcps');
  });

  it('drops --worktree / -w / --worktree-base from extraArgs, including the following value', () => {
    const b = buildArgs(input({ options: { extraArgs: ['--foo', '--worktree', 'auth-fix', '-w', 'other', '--worktree-base', 'main', '--bar'] } }));
    expect(b.args).toContain('--foo');
    expect(b.args).toContain('--bar');
    expect(b.args).not.toContain('--worktree');
    expect(b.args).not.toContain('-w');
    expect(b.args).not.toContain('--worktree-base');
    expect(b.args).not.toContain('auth-fix');
    expect(b.args).not.toContain('other');
    expect(b.args).not.toContain('main');
  });

  it('drops acp and worker from extraArgs', () => {
    const b = buildArgs(input({ options: { extraArgs: ['acp', 'worker', '--keep'] } }));
    expect(b.args).toContain('--keep');
    expect(b.args).not.toContain('acp');
    expect(b.args).not.toContain('worker');
  });

  it('sets CURSOR_CONFIG_DIR and forwards --model', () => {
    const b = buildArgs(input({ model: 'auto', configHome: '/ws/.agent-conductor/runtimes/cursor' }));
    expect(s(b.args)).toContain('--model auto');
    expect(b.env['CURSOR_CONFIG_DIR']).toBe('/ws/.agent-conductor/runtimes/cursor');
  });
});

describe('cursor buildArgs — liveInput: false', () => {
  it('puts a short prompt after -- and closes the live channel', () => {
    const b = buildArgs(input({ options: { liveInput: false } }));
    expect(b.liveInput).toBe(false);
    expect(b.args.slice(-2)).toEqual(['--', 'do the thing']);
    expect(b.stdin).toBeNull();
  });

  it('moves an oversized prompt to stdin as plain text', () => {
    const big = 'x'.repeat(MAX_ARGV_PROMPT + 1);
    const b = buildArgs(input({ prompt: big, options: { liveInput: false } }));
    expect(b.stdin).toBe(big);
    expect(b.args).not.toContain(big);
  });
});
