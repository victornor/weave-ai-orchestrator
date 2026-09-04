import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@agent-conductor/runtime-sdk';
import { buildArgs, mcpConfigToml, mcpOverrides } from '../src/args.js';

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

describe('codex buildArgs', () => {
  it('builds a new thread with the prompt on stdin', () => {
    const b = buildArgs(input(), { tmpDir: '/tmp/ac' });
    expect(b.cmd).toBe('codex');
    expect(s(b.args)).toContain('exec --json --skip-git-repo-check -C /home/agent --sandbox workspace-write');
    expect(s(b.args)).toContain('-o /tmp/ac/last-message.txt');
    expect(b.args.at(-1)).toBe('-');
    expect(b.stdin).toBe('do the thing');
    expect(b.mode).toBe('new');
    // file_only prompt injection: the charter is AGENTS.md at cwd, never a flag
    expect(s(b.args)).not.toContain('system-prompt');
  });

  it('resumes and forks without -C or --sandbox (unsupported on those subcommands)', () => {
    const r = buildArgs(input({ session: { policy: 'per_ticket', ref: { threadId: 'th-1' }, isFirstTurn: false } }), { tmpDir: '/tmp/ac' });
    expect(r.args.slice(0, 3)).toEqual(['exec', 'resume', 'th-1']);
    expect(r.args).not.toContain('-C');
    expect(r.args).not.toContain('--sandbox');
    expect(s(r.args)).toContain('-c sandbox_mode="workspace-write"');
    expect(r.mode).toBe('resume');

    const f = buildArgs(input({ session: { policy: 'per_ticket', ref: { threadId: 'th-1', fork: true }, isFirstTurn: false } }));
    expect(f.args.slice(0, 3)).toEqual(['exec', 'fork', 'th-1']);
    expect(f.mode).toBe('fork');
  });

  it('maps permission postures onto the sandbox', () => {
    expect(s(buildArgs(input({ permission: { mode: 'restricted' } })).args)).toContain('--sandbox read-only');
    const bypass = buildArgs(input({ permission: { mode: 'bypass' } })).args;
    expect(bypass).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(bypass).not.toContain('--sandbox');
  });

  it('passes model, effort and the output schema file', () => {
    const b = buildArgs(input({ model: 'gpt-5.1-codex', effort: 'high', outputSchema: { type: 'object' } }), { tmpDir: '/tmp/ac' });
    expect(s(b.args)).toContain('-m gpt-5.1-codex');
    expect(s(b.args)).toContain('-c model_reasoning_effort="high"');
    expect(s(b.args)).toContain('--output-schema /tmp/ac/output-schema.json');
    expect(b.files.find((f) => f.path === '/tmp/ac/output-schema.json')).toBeTruthy();
  });

  it('passes MCP per invocation and keeps the bearer token out of argv', () => {
    const b = buildArgs(input({
      mcpServers: { agentconductor: { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer secret-token', 'X-Trace': 'abc' } } },
    }));
    expect(s(b.args)).toContain('-c mcp_servers.agentconductor.url="http://127.0.0.1:7777/mcp/runs/run-1"');
    expect(s(b.args)).toContain('-c mcp_servers.agentconductor.bearer_token_env_var="AC_MCP_TOKEN_AGENTCONDUCTOR"');
    expect(s(b.args)).toContain('-c mcp_servers.agentconductor.http_headers.X-Trace="abc"');
    expect(s(b.args)).not.toContain('secret-token');
    expect(b.env['AC_MCP_TOKEN_AGENTCONDUCTOR']).toBe('secret-token');
  });

  it('falls back to CODEX_HOME/config.toml when asked', () => {
    const b = buildArgs(input({
      configHome: '/ws/.agent-conductor/runtimes/codex',
      options: { mcpViaConfigFile: true },
      mcpServers: { agentconductor: { type: 'http', url: 'http://h/mcp', headers: { Authorization: 'Bearer t' } } },
    }));
    expect(b.env['CODEX_HOME']).toBe('/ws/.agent-conductor/runtimes/codex');
    expect(s(b.args)).not.toContain('mcp_servers');
    const f = b.files.find((x) => x.path === '/ws/.agent-conductor/runtimes/codex/config.toml')!;
    expect(f.content).toContain('[mcp_servers.agentconductor]');
    expect(f.content).toContain('url = "http://h/mcp"');
  });

  it('mcpOverrides/mcpConfigToml handle stdio servers', () => {
    const o = mcpOverrides('local', { type: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' } });
    expect(s(o.args)).toBe('-c mcp_servers.local.command="node" -c mcp_servers.local.args=["server.js"] -c mcp_servers.local.env.A="1"');
    expect(mcpConfigToml({ local: { type: 'stdio', command: 'node', args: ['server.js'] } })).toContain('command = "node"');
  });
});
