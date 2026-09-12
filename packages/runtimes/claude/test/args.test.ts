import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@weave-ai/runtime-sdk';
import { buildArgs, MAX_ARGV_PROMPT, resumeCommand, RESTRICTED_TOOLS, userFrame } from '../src/args.js';

const NEW_ID = '11111111-2222-4333-8444-555555555555';

function input(over: Partial<TurnInput> = {}): TurnInput {
  return {
    runId: 'run-1', turnEpoch: 1, cwd: '/home/agent', worktree: null,
    session: { policy: 'per_ticket', ref: null, isFirstTurn: true },
    systemPrompt: { text: '', mode: 'skip' },
    prompt: 'do the thing', mcpServers: {}, env: {}, options: {},
    limits: { timeoutMs: 60_000 }, permission: { mode: 'auto' },
    ...over,
  };
}
const pairs = (a: string[]) => a.join(' ');

describe('claude buildArgs — live input (default)', () => {
  it('builds the stream-json-in / stream-json-out invocation with a fresh session id', () => {
    const b = buildArgs(input(), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(b.cmd).toBe('claude');
    expect(pairs(b.args)).toContain('-p --output-format stream-json --verbose --input-format stream-json --replay-user-messages');
    expect(pairs(b.args)).toContain(`--session-id ${NEW_ID}`);
    expect(b.args).not.toContain('--resume');
    expect(b.sessionId).toBe(NEW_ID);
    expect(b.resumed).toBe(false);
    expect(b.liveInput).toBe(true);
  });

  it('carries the prompt as the first user frame on stdin, never as an argv operand', () => {
    const b = buildArgs(input({ prompt: 'do the thing' }), { newSessionId: NEW_ID });
    expect(b.args).not.toContain('do the thing');
    expect(b.stdin).toBe(userFrame('do the thing'));
    expect(JSON.parse(b.stdin!.trimEnd())).toEqual({ type: 'user', message: { role: 'user', content: 'do the thing' } });
  });

  it('puts the whole prompt on stdin regardless of length — there is no argv to overflow', () => {
    const big = 'x'.repeat(MAX_ARGV_PROMPT + 1);
    const b = buildArgs(input({ prompt: big }), { newSessionId: NEW_ID });
    expect(b.args).not.toContain(big);
    expect(JSON.parse(b.stdin!.trimEnd())).toEqual({ type: 'user', message: { role: 'user', content: big } });
  });

  it('resumes a stored session and never re-issues --session-id', () => {
    const b = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'abc' }, isFirstTurn: false } }), { newSessionId: NEW_ID });
    expect(pairs(b.args)).toContain('--resume abc');
    expect(b.args).not.toContain('--session-id');
    expect(b.resumed).toBe(true);
    expect(b.sessionId).toBe('abc');
  });

  it('adds --fork-session for a forked ref', () => {
    const b = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'abc', fork: true }, isFirstTurn: true } }), { newSessionId: NEW_ID });
    expect(pairs(b.args)).toContain('--resume abc --fork-session');
  });

  it('injects the system prompt as a file only when mode=inject', () => {
    const skip = buildArgs(input({ systemPrompt: { text: 'charter', mode: 'skip' } }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(skip.files).toHaveLength(0);
    expect(skip.args.join(' ')).not.toContain('system-prompt');

    const inject = buildArgs(input({ systemPrompt: { text: 'charter', mode: 'inject' } }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(pairs(inject.args)).toContain('--append-system-prompt-file /tmp/ac/system-prompt.md');
    expect(inject.files).toEqual([{ path: '/tmp/ac/system-prompt.md', content: 'charter' }]);

    const replace = buildArgs(input({ systemPrompt: { text: 'charter', mode: 'inject' }, options: { systemPromptMode: 'replace' } }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(pairs(replace.args)).toContain('--system-prompt-file /tmp/ac/system-prompt.md');
  });

  it('passes the output schema inline and the mcp config as a strict file', () => {
    const b = buildArgs(input({
      outputSchema: { type: 'object', properties: { state: { type: 'string' } } },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } } },
    }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    const i = b.args.indexOf('--json-schema');
    expect(JSON.parse(b.args[i + 1]!)).toEqual({ type: 'object', properties: { state: { type: 'string' } } });
    expect(pairs(b.args)).toContain('--mcp-config /tmp/ac/mcp-config.json --strict-mcp-config');
    const cfg = JSON.parse(b.files.find((f) => f.path.endsWith('mcp-config.json'))!.content);
    expect(cfg.mcpServers['weave-ai']).toEqual({ type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } });
  });

  it('maps the three permission postures', () => {
    expect(pairs(buildArgs(input({ permission: { mode: 'auto' } }), { newSessionId: NEW_ID }).args)).toContain('--permission-mode auto');
    expect(pairs(buildArgs(input({ permission: { mode: 'bypass' } }), { newSessionId: NEW_ID }).args))
      .toContain('--permission-mode bypassPermissions --allow-dangerously-skip-permissions');
    const r = pairs(buildArgs(input({ permission: { mode: 'restricted' } }), { newSessionId: NEW_ID }).args);
    expect(r).toContain('--permission-mode dontAsk --restricted --tools');
    expect(r).toContain(RESTRICTED_TOOLS.join(','));
  });

  it('allowlists the MCP control plane in restricted mode (dontAsk denies by default)', () => {
    const b = buildArgs(input({
      permission: { mode: 'restricted' },
      mcpServers: { 'weave-ai': { type: 'http', url: 'http://h/mcp' } },
    }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(pairs(b.args)).toContain('--allowedTools mcp__weave-ai');
    // auto mode needs no such allowlist
    const auto = buildArgs(input({ permission: { mode: 'auto' }, mcpServers: { 'weave-ai': { type: 'http', url: 'http://h/mcp' } } }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(auto.args).not.toContain('--allowedTools');
  });

  it('forwards tool lists, model, effort, limits and extraArgs', () => {
    const b = buildArgs(input({
      permission: { mode: 'auto', allowedTools: ['Bash(git *)'], deniedTools: ['WebFetch'] },
      model: 'fable', effort: 'high', limits: { timeoutMs: 1, maxTurns: 12, maxBudgetUsd: 2.5 },
      options: { extraArgs: ['--no-session-persistence'] },
    }), { newSessionId: NEW_ID });
    const s = pairs(b.args);
    expect(s).toContain('--allowedTools Bash(git *)');
    expect(s).toContain('--disallowedTools WebFetch');
    expect(s).toContain('--model fable');
    expect(s).toContain('--effort high');
    expect(s).toContain('--max-turns 12');
    expect(s).toContain('--max-budget-usd 2.5');
    expect(s).toContain('--no-session-persistence');
  });

  it('adds --add-dir only for a worktree outside the home, and sets CLAUDE_CONFIG_DIR', () => {
    const inside = buildArgs(input({ worktree: { path: '/home/agent/work', branch: 'b' } }), { newSessionId: NEW_ID });
    expect(inside.args).not.toContain('--add-dir');
    const outside = buildArgs(input({ worktree: { path: '/srv/wt/acme-42', branch: 'b' }, configHome: '/ws/.agent-conductor/runtimes/claude', env: { AC_RUN_ID: 'run-1' } }), { newSessionId: NEW_ID });
    expect(pairs(outside.args)).toContain('--add-dir /srv/wt/acme-42');
    expect(outside.env).toEqual({ AC_RUN_ID: 'run-1', CLAUDE_CONFIG_DIR: '/ws/.agent-conductor/runtimes/claude' });
  });
});

describe('claude buildArgs — liveInput: false (legacy, argv/text-stdin prompt)', () => {
  it('reverts to --input-format text with no --replay-user-messages', () => {
    const b = buildArgs(input({ options: { liveInput: false } }), { newSessionId: NEW_ID, tmpDir: '/tmp/ac' });
    expect(pairs(b.args)).toContain('-p --output-format stream-json --verbose --input-format text');
    expect(pairs(b.args)).not.toContain('--replay-user-messages');
    expect(b.liveInput).toBe(false);
    expect(b.args[6]).toBe('do the thing'); // operand sits before any variadic flag
    expect(b.stdin).toBeNull();
  });

  it('keeps the prompt ahead of variadic tool flags', () => {
    const b = buildArgs(input({ permission: { mode: 'auto', deniedTools: ['WebFetch'] }, options: { liveInput: false } }), { newSessionId: NEW_ID });
    expect(b.args.indexOf('do the thing')).toBeLessThan(b.args.indexOf('--disallowedTools'));
  });

  it('moves an oversized prompt to stdin as plain text', () => {
    const big = 'x'.repeat(MAX_ARGV_PROMPT + 1);
    const b = buildArgs(input({ prompt: big, options: { liveInput: false } }), { newSessionId: NEW_ID });
    expect(b.stdin).toBe(big);
    expect(b.args).not.toContain(big);
  });
});

describe('resumeCommand (VS-249)', () => {
  it('builds a bare --resume invocation with no headless flags', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'sess-1' } });
    expect(c.cmd).toBe('claude');
    expect(c.args).toEqual(['--resume', 'sess-1']);
  });

  it('adds --add-dir when the worktree is not under cwd', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: '/home/agent/work', session: { sessionId: 'sess-1' } });
    expect(c.args).not.toContain('--add-dir');
    const c2 = resumeCommand({ cwd: '/home/agent', worktreePath: '/elsewhere/work', session: { sessionId: 'sess-1' } });
    expect(c2.args).toEqual(['--resume', 'sess-1', '--add-dir', '/elsewhere/work']);
  });

  it('sets CLAUDE_CONFIG_DIR from configHome and nothing else', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'sess-1' }, configHome: '/ws/runtimes/claude' });
    expect(c.env).toEqual({ CLAUDE_CONFIG_DIR: '/ws/runtimes/claude' });
  });

  it('passes a model when given', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'sess-1' }, model: 'opus' });
    expect(c.args).toEqual(['--resume', 'sess-1', '--model', 'opus']);
  });
});
