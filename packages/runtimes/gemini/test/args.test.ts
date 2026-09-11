import { describe, expect, it } from 'vitest';
import type { TurnInput } from '@agent-conductor/runtime-sdk';
import { buildArgs, geminiSettings, MAX_ARGV_PROMPT, resumeCommand } from '../src/args.js';

const NEW_ID = '11111111-2222-4333-8444-555555555555';
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

describe('gemini buildArgs', () => {
  it('builds a headless stream-json turn with a chosen session id', () => {
    const b = buildArgs(input(), { newSessionId: NEW_ID });
    expect(b.cmd).toBe('gemini');
    expect(s(b.args)).toContain('-o stream-json --skip-trust');
    expect(s(b.args)).toContain(`--session-id ${NEW_ID}`);
    expect(s(b.args)).toContain('--approval-mode auto_edit');
    expect(b.args.slice(-2)).toEqual(['-p', 'do the thing']);
    expect(b.stdin).toBeNull();
    expect(b.sessionId).toBe(NEW_ID);
  });

  it('resumes a stored session', () => {
    const b = buildArgs(input({ session: { policy: 'per_ticket', ref: { sessionId: 'sess-9' }, isFirstTurn: false } }), { newSessionId: NEW_ID });
    expect(s(b.args)).toContain('--resume sess-9');
    expect(b.args).not.toContain('--session-id');
    expect(b.resumed).toBe(true);
  });

  it('maps permission postures to approval modes', () => {
    expect(s(buildArgs(input({ permission: { mode: 'bypass' } }), { newSessionId: NEW_ID }).args)).toContain('--approval-mode yolo');
    expect(s(buildArgs(input({ permission: { mode: 'restricted' } }), { newSessionId: NEW_ID }).args)).toContain('--approval-mode plan');
  });

  it('writes MCP servers into .gemini/settings.json in cwd', () => {
    const b = buildArgs(input({ mcpServers: { agentconductor: { type: 'http', url: 'http://127.0.0.1:7777/mcp/runs/run-1', headers: { Authorization: 'Bearer t' } } } }), { newSessionId: NEW_ID });
    const f = b.files.find((x) => x.path === '/home/agent/.gemini/settings.json')!;
    expect(JSON.parse(f.content).mcpServers.agentconductor).toEqual({
      httpUrl: 'http://127.0.0.1:7777/mcp/runs/run-1', type: 'http', trust: true, headers: { Authorization: 'Bearer t' },
    });
    expect(JSON.parse(geminiSettings({ l: { type: 'stdio', command: 'node', args: ['s.js'] } })).mcpServers.l)
      .toEqual({ command: 'node', args: ['s.js'], type: 'stdio', trust: true });
  });

  it('adds --include-directories only for a worktree outside the home and sets GEMINI_CLI_HOME', () => {
    expect(buildArgs(input({ worktree: { path: '/home/agent/work', branch: 'b' } }), { newSessionId: NEW_ID }).args).not.toContain('--include-directories');
    const b = buildArgs(input({ worktree: { path: '/srv/wt/x', branch: 'b' }, configHome: '/ws/rt/gemini' }), { newSessionId: NEW_ID });
    expect(s(b.args)).toContain('--include-directories /srv/wt/x');
    expect(b.env['GEMINI_CLI_HOME']).toBe('/ws/rt/gemini');
  });

  it('splits an oversized prompt head->stdin, tail->-p (gemini prepends stdin)', () => {
    const big = `${'x'.repeat(MAX_ARGV_PROMPT)}TAIL`;
    const b = buildArgs(input({ prompt: big }), { newSessionId: NEW_ID });
    expect(`${b.stdin}${b.args.at(-1)}`).toBe(big);
    expect(b.args.at(-1)!.endsWith('TAIL')).toBe(true);
  });
});

describe('resumeCommand (VS-249)', () => {
  it('builds a bare --resume invocation with no headless flags', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'sess-1' } });
    expect(c.cmd).toBe('gemini');
    expect(c.args).toEqual(['--resume', 'sess-1']);
    expect(c.args).not.toContain('-o');
    expect(c.args).not.toContain('-p');
  });

  it('adds --include-directories when the worktree is not under cwd', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: '/elsewhere/work', session: { sessionId: 'sess-1' } });
    expect(c.args).toEqual(['--resume', 'sess-1', '--include-directories', '/elsewhere/work']);
  });

  it('sets GEMINI_CLI_HOME from configHome and nothing else', () => {
    const c = resumeCommand({ cwd: '/home/agent', worktreePath: null, session: { sessionId: 'sess-1' }, configHome: '/ws/runtimes/gemini' });
    expect(c.env).toEqual({ GEMINI_CLI_HOME: '/ws/runtimes/gemini' });
  });
});
