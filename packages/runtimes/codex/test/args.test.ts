import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { buildArgs, mcpConfigToml, mcpOverrides, resumeCommand } from '../src/args.js';

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
const tokenKey = (name: string) => `AC_MCP_TOKEN_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${createHash('sha256').update(name).digest('hex').slice(0, 12).toUpperCase()}`;

describe('codex buildArgs', () => {
  it('builds a new thread with the prompt on stdin', () => {
    const b = buildArgs(input(), { tmpDir: '/tmp/ac' });
    expect(b.cmd).toBe('codex');
    expect(s(b.args)).toContain('exec --json --skip-git-repo-check -C /home/agent --sandbox workspace-write');
    expect(s(b.args)).toContain('-c approval_policy="on-request"');
    expect(b.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(s(b.args)).toContain('-o /tmp/ac/last-message.txt');
    expect(b.args.at(-1)).toBe('-');
    expect(b.stdin).toBe('do the thing');
    expect(b.mode).toBe('new');
    // file_only prompt injection: the charter is AGENTS.md at cwd, never a flag
    expect(s(b.args)).not.toContain('system-prompt');
  });

  it('resumes and forks without -C or --sandbox while keeping auto approval', () => {
    const r = buildArgs(input({ session: { policy: 'per_ticket', ref: { threadId: 'th-1' }, isFirstTurn: false } }), { tmpDir: '/tmp/ac' });
    expect(r.args.slice(0, 3)).toEqual(['exec', 'resume', 'th-1']);
    expect(r.args).not.toContain('-C');
    expect(r.args).not.toContain('--sandbox');
    expect(s(r.args)).toContain('-c sandbox_mode="workspace-write"');
    expect(s(r.args)).toContain('-c approval_policy="on-request"');
    expect(r.mode).toBe('resume');

    const f = buildArgs(input({ session: { policy: 'per_ticket', ref: { threadId: 'th-1', fork: true }, isFirstTurn: false } }));
    expect(f.args.slice(0, 3)).toEqual(['exec', 'fork', 'th-1']);
    expect(s(f.args)).toContain('-c sandbox_mode="workspace-write"');
    expect(s(f.args)).toContain('-c approval_policy="on-request"');
    expect(f.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(f.mode).toBe('fork');
  });

  it('maps permission postures onto the sandbox', () => {
    const restricted = buildArgs(input({ permission: { mode: 'restricted' } })).args;
    expect(s(restricted)).toContain('--sandbox read-only');
    expect(s(restricted)).not.toContain('approval_policy');
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
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer secret-token', 'X-Trace': 'abc' } } },
    }));
    expect(s(b.args)).toContain('-c mcp_servers.weave-ai.url="http://127.0.0.1:7777/mcp/runs/run-1"');
    expect(s(b.args)).toContain(`-c mcp_servers.weave-ai.bearer_token_env_var="${tokenKey('weave-ai')}"`);
    expect(s(b.args)).toContain('-c mcp_servers.weave-ai.default_tools_approval_mode="never"');
    expect(s(b.args)).toContain('-c mcp_servers.weave-ai.http_headers={X-Trace="abc"}');
    expect(s(b.args)).not.toContain('secret-token');
    expect(b.env[tokenKey('weave-ai')]).toBe('secret-token');
  });

  it.each([
    null,
    { threadId: 'thread-1' },
    { threadId: 'thread-1', fork: true },
  ])('keeps the ticket-scoped MCP server on an auto %s turn', (ref) => {
    const b = buildArgs(input({
      session: { policy: 'per_ticket', ref, isFirstTurn: !ref },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer secret-token' } } },
    }));
    expect(s(b.args)).toContain('mcp_servers.weave-ai.url="http://127.0.0.1:7777/mcp/runs/run-1"');
    expect(s(b.args)).toContain('mcp_servers.weave-ai.default_tools_approval_mode="never"');
    expect(s(b.args)).toContain('approval_policy="on-request"');
    expect(s(b.args)).not.toContain('secret-token');
    expect(b.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(b.env[tokenKey('weave-ai')]).toBe('secret-token');
  });

  it.each([
    ['auto', null], ['auto', { threadId: 'thread-1' }], ['auto', { threadId: 'thread-1', fork: true }],
    ['restricted', null], ['restricted', { threadId: 'thread-1' }], ['restricted', { threadId: 'thread-1', fork: true }],
  ] as const)('keeps %s MCP calls outside the approval prompt for %s turns', (mode, ref) => {
    const b = buildArgs(input({
      permission: { mode }, session: { policy: 'per_ticket', ref, isFirstTurn: !ref },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1' } },
    }));
    expect(s(b.args)).toContain('mcp_servers.weave-ai.default_tools_approval_mode="never"');
    expect(s(b.args)).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    if (mode === 'auto') expect(s(b.args)).toContain('workspace-write');
    else expect(s(b.args)).toContain('read-only');
  });

  it('falls back to CODEX_HOME/config.toml when asked', () => {
    const b = buildArgs(input({
      configHome: '/ws/.agent-conductor/runtimes/codex',
      options: { mcpViaConfigFile: true },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://h/mcp', headers: { Authorization: 'Bearer t' } } },
    }));
    expect(b.env['CODEX_HOME']).toBe('/ws/.agent-conductor/runtimes/codex');
    expect(s(b.args)).not.toContain('mcp_servers');
    const f = b.files.find((x) => x.path === '/ws/.agent-conductor/runtimes/codex/config.toml')!;
    expect(f.content).toContain('[mcp_servers.weave-ai]');
    expect(f.content).toContain('url = "http://h/mcp"');
    expect(f.content).toContain('default_tools_approval_mode = "never"');
  });

  it('mcpOverrides/mcpConfigToml handle stdio servers', () => {
    const o = mcpOverrides('local', { type: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' } });
    expect(s(o.args)).toBe('-c mcp_servers.local.command="node" -c mcp_servers.local.args=["server.js"] -c mcp_servers.local.env={A="1"} -c mcp_servers.local.supports_parallel_tool_calls=true');
    expect(mcpConfigToml({ local: { type: 'stdio', command: 'node', args: ['server.js'] } })).toContain('command = "node"');
  });

  it('lets the model batch calls to a server by declaring it parallel-capable', () => {
    expect(s(mcpOverrides('weave-ai', { type: 'http', url: 'http://h/mcp' }).args)).toContain('mcp_servers.weave-ai.supports_parallel_tool_calls=true');
    expect(mcpConfigToml({ 'weave-ai': { type: 'http', url: 'http://h/mcp' } })).toContain('supports_parallel_tool_calls = true');
  });
});


it('preserves existing runtime config by using invocation overrides', () => {
  const b = buildArgs(input({ configHome: '/ws/codex', options: { mcpViaConfigFile: true }, mcpServers: { ac: { type: 'http', url: 'http://local/mcp' } } }), { configExists: true });
  expect(b.files.some((f) => f.path === '/ws/codex/config.toml')).toBe(false);
  expect(s(b.args)).toContain('mcp_servers.ac.url=');
});

it('serializes stdio env and quotes dotted TOML keys', () => {
  const server = { type: 'stdio' as const, command: 'node', env: { 'A.B': 'value' } };
  expect(mcpConfigToml({ 'local.test': server })).toContain('[mcp_servers."local.test".env]');
  expect(mcpConfigToml({ 'local.test': server })).toContain('"A.B" = "value"');
  expect(s(mcpOverrides('local', server).args)).toContain('mcp_servers.local.env={"A.B"="value"}');
});

it('keeps bearer secrets out of generated config files', () => {
  const b = buildArgs(input({ configHome: '/ws/codex', options: { mcpViaConfigFile: true }, mcpServers: { ac: { type: 'http', url: 'http://local/mcp', headers: { Authorization: 'Bearer hidden-token' } } } }));
  expect(b.files[0]?.content).toContain(`bearer_token_env_var = "${tokenKey('ac')}"`);
  expect(b.files[0]?.content).not.toContain('hidden-token');
  expect(b.env[tokenKey('ac')]).toBe('hidden-token');
});

it('does not add a per-server approval override to bypass turns', () => {
  const b = buildArgs(input({
    permission: { mode: 'bypass' },
    mcpServers: { 'weave-ai': { type: 'http', url: 'http://local/mcp' } },
  }));
  expect(s(b.args)).not.toContain('default_tools_approval_mode');
});


it('keeps tokens distinct for server names that normalize to the same environment prefix', () => {
  const b = buildArgs(input({ mcpServers: {
    'ac-tools': { type: 'http', url: 'http://one/mcp', headers: { Authorization: 'Bearer first' } },
    ac_tools: { type: 'http', url: 'http://two/mcp', headers: { Authorization: 'Bearer second' } },
    'AC-TOOLS': { type: 'http', url: 'http://three/mcp', headers: { Authorization: 'Bearer third' } },
  } }));
  expect(Object.values(b.env)).toEqual(expect.arrayContaining(['first', 'second', 'third']));
  expect(Object.keys(b.env)).toHaveLength(3);
});

describe('resumeCommand (VS-249)', () => {
  it('builds a bare `resume <threadId>` invocation, not `exec resume`', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { threadId: 'thread-1' } });
    expect(c.cmd).toBe('codex');
    expect(c.args).toEqual(['resume', 'thread-1']);
    expect(c.args).not.toContain('exec');
    expect(c.args).not.toContain('--json');
  });

  it('sets CODEX_HOME from configHome and nothing else', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { threadId: 'thread-1' }, configHome: '/ws/runtimes/codex' });
    expect(c.env).toEqual({ CODEX_HOME: '/ws/runtimes/codex' });
  });
});

it('bounds retained tool output and compacts history earlier on every invocation', () => {
  const defaults = buildArgs(input()).args;
  expect(defaults).toContain('tool_output_token_limit=4096');
  expect(defaults.some(arg => arg.startsWith('model_auto_compact_token_limit='))).toBe(false);
  expect(buildArgs(input(), { modelContextWindowTokens: 1000000 }).args).toContain('model_auto_compact_token_limit=600000');
  expect(buildArgs(input({ options: { contextWindowTokens: 1000000, compactionPercent: 75 } })).args).toContain('model_auto_compact_token_limit=750000');
  expect(buildArgs(input({ options: { contextWindowTokens: 1000000 } })).args).toContain('model_context_window=1000000');
  expect(() => buildArgs(input({ options: { compactionPercent: 101 } }))).toThrow('compactionPercent');
  const configured = buildArgs(input({ options: { toolOutputTokenLimit: 2048, autoCompactTokenLimit: 48000 }, session: { policy: 'per_ticket', ref: { threadId: 't' }, isFirstTurn: false } })).args;
  expect(configured).toContain('tool_output_token_limit=2048');
  expect(configured).toContain('model_auto_compact_token_limit=48000');
  expect(() => buildArgs(input({ options: { autoCompactTokenLimit: -1 } }))).toThrow('positive integer');
});
