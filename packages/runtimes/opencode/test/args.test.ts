import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { childEnv } from '@weave-ai/runtime-sdk';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { buildArgs, opencodeConfig, resumeCommand } from '../src/args.js';

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
    const b = buildArgs(input({ mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } } } }));
    const f = b.files.find((x) => x.path === '/home/agent/.opencode/opencode.json')!;
    expect(JSON.parse(f.content).mcp['weave-ai']).toEqual({
      type: 'remote', url: 'http://127.0.0.1:7777/mcp/runs/run-1', enabled: true, headers: { Authorization: 'Bearer t' },
    });
  });

  it('writes no config file when there are no MCP servers', () => {
    expect(buildArgs(input()).files).toHaveLength(0);
  });

  it('disables opencode native tools on an interactive opening turn (VS-462)', () => {
    const b = buildArgs(input({
      permission: { mode: 'auto', firstTurn: true },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1' } },
    }));
    const cfg = JSON.parse(b.files.find((x) => x.path === '/home/agent/.opencode/opencode.json')!.content);
    // Every tool that could read or touch the repo is off; the MCP control plane is untouched.
    for (const name of ['bash', 'edit', 'read', 'grep', 'glob', 'skill', 'webfetch']) expect(cfg.tools[name]).toBe(false);
    expect(cfg.mcp['weave-ai']).toBeDefined();
  });

  it('leaves the tools switch unset on an ordinary turn', () => {
    const b = buildArgs(input({ mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1' } } }));
    expect(JSON.parse(b.files[0]!.content).tools).toBeUndefined();
  });

  it('isolates every XDG root and HOME to the runtime home (VS-161, VS-436)', () => {
    const home = '/ws/.agent-conductor/runtimes/opencode';
    expect(buildArgs(input({ configHome: home })).env).toEqual({
      XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home,
      XDG_STATE_HOME: home,
      XDG_CACHE_HOME: home,
      HOME: home,
    });
  });

  it('never leaves XDG_STATE_HOME at the host user state dir (VS-436)', () => {
    const home = '/ws/.agent-conductor/runtimes/opencode';
    const env = buildArgs(input({ configHome: home })).env;
    expect(env['XDG_STATE_HOME']).not.toBe(join(homedir(), '.local', 'state'));
    expect(env['XDG_STATE_HOME']).toBe(home);
  });

  it('overrides an XDG_STATE_HOME inherited from the host in the spawned child (VS-436)', () => {
    // The daemon process carries the host user's XDG_STATE_HOME; `childEnv` merges that whole
    // environment, so only the adapter overlay relocating it stops the leak into the worker.
    vi.stubEnv('XDG_STATE_HOME', '/home/user/.local/state');
    const home = '/ws/.agent-conductor/runtimes/opencode';
    const env = childEnv(buildArgs(input({ configHome: home })).env);
    expect(env['XDG_STATE_HOME']).toBe(home);
    expect(env['XDG_CACHE_HOME']).toBe(home);
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it('emits a local MCP server as a command array', () => {
    expect(JSON.parse(opencodeConfig({ l: { type: 'stdio', command: 'node', args: ['s.js'], env: { A: '1' } } })).mcp.l)
      .toEqual({ type: 'local', command: ['node', 's.js'], enabled: true, environment: { A: '1' } });
  });
});

describe('resumeCommand (VS-249)', () => {
  it('builds a bare -s <sessionId> invocation, not `run`', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'ses_1' } });
    expect(c.cmd).toBe('opencode');
    expect(c.args).toEqual(['-s', 'ses_1']);
    expect(c.args).not.toContain('run');
    expect(c.args).not.toContain('--format');
  });

  it('relocates HOME and every XDG dir to configHome, matching buildArgs', () => {
    const home = '/ws/runtimes/opencode';
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'ses_1' }, configHome: home });
    expect(c.env).toEqual({
      HOME: home,
      XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home,
      XDG_STATE_HOME: home,
      XDG_CACHE_HOME: home,
    });
  });
});
