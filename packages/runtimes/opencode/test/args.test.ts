import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@openconductor/runtime-sdk';
import { buildArgs, opencodeConfig } from '../src/args.js';

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

describe('opencode buildArgs', () => {
  it('builds a new run with the message after --', () => {
    const b = buildArgs(input());
    expect(b.cmd).toBe('opencode');
    expect(s(b.args)).toContain('run --format json --dir /home/agent');
    expect(b.args.slice(-2)).toEqual(['--', 'do the thing']);
    expect(b.args).toContain('--auto');
    expect(b.resumed).toBe(false);
    expect(b.stdin).toBeNull();
  });

  it('resumes and forks a session', () => {
    const r = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'ses_1' }, isFirstTurn: false } }));
    expect(s(r.args)).toContain('-s ses_1');
    expect(r.args).not.toContain('--fork');
    expect(r.resumed).toBe(true);
    const f = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'ses_1', fork: true }, isFirstTurn: false } }));
    expect(s(f.args)).toContain('-s ses_1 --fork');
  });

  it('maps model, variant, agent and the restricted posture', () => {
    const b = buildArgs(input({ model: 'anthropic/claude-sonnet-5', effort: 'high', options: { agent: 'build' }, permission: { mode: 'restricted' } }));
    expect(s(b.args)).toContain('-m anthropic/claude-sonnet-5');
    expect(s(b.args)).toContain('--variant high');
    expect(s(b.args)).toContain('--agent build');
    expect(b.args).not.toContain('--auto');
  });

  it('writes the MCP server into .opencode/opencode.json in cwd', () => {
    const b = buildArgs(input({ mcpServers: { openconductor: { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } } } }));
    const f = b.files.find((x) => x.path === '/home/agent/.opencode/opencode.json')!;
    expect(JSON.parse(f.content).mcp.openconductor).toEqual({
      type: 'remote', url: 'http://127.0.0.1:7777/mcp/runs/run-1', enabled: true, headers: { Authorization: 'Bearer t' },
    });
  });

  it('writes no config file when there are no MCP servers', () => {
    expect(buildArgs(input()).files).toHaveLength(0);
  });

  it('isolates config via XDG dirs', () => {
    expect(buildArgs(input({ configHome: '/ws/.openconductor/runtimes/opencode' })).env).toMatchObject({
      XDG_CONFIG_HOME: '/ws/.openconductor/runtimes/opencode',
      XDG_DATA_HOME: '/ws/.openconductor/runtimes/opencode',
    });
  });

  it('emits a local MCP server as a command array', () => {
    expect(JSON.parse(opencodeConfig({ l: { type: 'stdio', command: 'node', args: ['s.js'], env: { A: '1' } } })).mcp.l)
      .toEqual({ type: 'local', command: ['node', 's.js'], enabled: true, environment: { A: '1' } });
  });
});
