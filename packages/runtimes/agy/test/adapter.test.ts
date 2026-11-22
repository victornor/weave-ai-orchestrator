import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnInput, TurnResult } from '@weave-ai/runtime-sdk';
import { adapter, AUTH_MESSAGE } from '../src/index.js';
import { writeFakeAgy } from './fakeAgy.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const WEAVE = { 'weave-ai': { type: 'http' as const, url: 'http://127.0.0.1:7433/mcp' } };

function input(fakeDir: string, over: Partial<TurnInput> = {}, env: Record<string, string> = {}): TurnInput {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`, turnEpoch: 1, cwd: tmp('ac-agy-home-'), worktree: null,
    session: { policy: 'resume', ref: null, isFirstTurn: true },
    systemPrompt: { text: '', mode: 'skip' }, prompt: 'do the thing', mcpServers: WEAVE,
    env: { PATH: `${fakeDir}:${process.env['PATH'] ?? ''}`, ...env }, options: {},
    limits: { timeoutMs: 30_000 }, permission: { mode: 'bypass' }, model: 'gemini-4-neon', effort: 'high',
    ...over,
  };
}

async function turn(i: TurnInput) {
  const events: RuntimeEvent[] = [];
  const raw: string[] = [];
  const started = Date.now();
  const result: TurnResult = await adapter.runTurn(i, { onSpawn: () => {}, onEvent: (e) => events.push(e), onRaw: (_s, l) => raw.push(l) });
  return { result, events, raw, ms: Date.now() - started };
}

describe('agy adapter — MCP surface (VS-995)', () => {
  it('a worker sees the weave server and none of the owner\'s personal servers', async () => {
    const fake = writeFakeAgy('ok'); dirs.push(fake);
    // The owner's own agy config, as on the daemon host: a personal `blender` server.
    const home = tmp('ac-owner-home-');
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { blender: { command: 'blender-mcp' } } }));
    const i = input(fake, {}, { HOME: home });
    // A server left behind by an earlier turn must not survive either.
    mkdirSync(join(i.cwd, '.agy', 'config'), { recursive: true });
    writeFileSync(join(i.cwd, '.agy', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { stale: { command: 'x' } } }));

    const { result } = await turn(i);
    expect(result.error).toBeUndefined();
    expect(result.structured).toEqual({ mcpServers: ['weave-ai'], gemini_dir: join(i.cwd, '.agy') });
  });
});

describe('agy adapter — turns, resume and accounting (VS-995)', () => {
  it('takes the conversation id as the session and resumes it on the next turn', async () => {
    const fake = writeFakeAgy('ok', { conversationId: 'conv-abc' }); dirs.push(fake);
    const log = join(tmp('ac-agy-log-'), 'argv.jsonl');
    const first = input(fake, {}, { FAKE_AGY_LOG: log });
    const t1 = await turn(first);
    expect(t1.result.session).toEqual({ conversationId: 'conv-abc' });
    const t2 = await turn({ ...first, runId: 'run-2', session: { policy: 'resume', ref: t1.result.session, isFirstTurn: false } });
    expect(t2.result.session).toEqual({ conversationId: 'conv-abc' });
    const turns = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]).filter((a) => a.includes('-p'));
    expect(turns).toHaveLength(2);
    expect(turns[0]).not.toContain('--conversation');
    expect(turns[1]![turns[1]!.indexOf('--conversation') + 1]).toBe('conv-abc');
    for (const a of turns) {
      expect(a.slice(0, 2)).toEqual(['--gemini_dir', join(first.cwd, '.agy')]);
      expect(a[a.indexOf('--model') + 1]).toBe('gemini-4-neon-high');
      expect(a).not.toContain('--effort');
    }
  });

  it('reports provider antigravity and the exact model id, never a cost', async () => {
    const fake = writeFakeAgy('ok'); dirs.push(fake);
    const { result } = await turn(input(fake, { model: 'claude-opus-5-5', effort: 'high' }));
    expect(result.provider).toBe('antigravity');
    expect(result.model).toBe('claude-opus-5-5-high');
    expect(result.cost).toBeUndefined();
    expect(adapter.capabilities.estimateCostByModel).toBe(false);
  });

  it('starts no turn when --gemini_dir stops isolating', async () => {
    const fake = writeFakeAgy('reject-dir'); dirs.push(fake);
    const log = join(tmp('ac-agy-log-'), 'argv.jsonl');
    const { result } = await turn(input(fake, {}, { FAKE_AGY_LOG: log }));
    expect(result.error).toMatchObject({ code: 'agy_isolation_failed', family: 'tooling' });
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    expect(calls.some((a) => a.includes('-p'))).toBe(false);
  });
});

describe('agy adapter — two captured turns end to end (VS-995)', () => {
  it('resumes the captured conversation and reports per-turn usage and the report', async () => {
    const fake = writeFakeAgy('replay'); dirs.push(fake);
    const log = join(tmp('ac-agy-log-'), 'argv.jsonl');
    const first = input(fake, { outputSchema: { type: 'object' } }, { FAKE_AGY_LOG: log });
    const t1 = await turn(first);
    expect(t1.result.error).toBeUndefined();
    expect(t1.result.session).toEqual({ conversationId: 'bf1094f5-0123-4994-926b-c0bba7374957' });
    expect(t1.result.structured).toEqual({ word: 'weave-capture-7' });
    expect(t1.result.model).toBe('gemini-4-neon-low');
    expect(t1.result.usage).toMatchObject({ inputTokens: 28344, cachedInputTokens: 14487, outputTokens: 379, contextTokens: 9751, basis: 'per_turn' });
    expect(t1.events.map((e) => e.type)).toContain('tool.call');

    const t2 = await turn({ ...first, runId: 'run-2', session: { policy: 'resume', ref: t1.result.session, isFirstTurn: false } });
    expect(t2.result.session).toEqual(t1.result.session);
    expect(t2.result.usage).toMatchObject({ inputTokens: 10170, cachedInputTokens: 7702, outputTokens: 74 });
    const argv = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]).filter((a) => a.includes('-p'));
    expect(argv[1]![argv[1]!.indexOf('--conversation') + 1]).toBe('bf1094f5-0123-4994-926b-c0bba7374957');
  });
});

describe('agy adapter — authentication (VS-995)', () => {
  it('stops at the login prompt instead of waiting 60 s, as an auth failure with no URL', async () => {
    const fake = writeFakeAgy('auth'); dirs.push(fake);
    const { result, raw, ms } = await turn(input(fake));
    expect(ms).toBeLessThan(10_000);
    expect(result.error).toEqual({ code: 'auth', family: 'auth', message: AUTH_MESSAGE });
    // The captured URL's random part contains 429 and 503: still `auth`, never quota or transient.
    expect(result.error?.message).not.toContain('https://');
    expect(raw.join('\n')).not.toContain('accounts.google.com');
    expect(raw.join('\n')).toContain('Authentication required.');
  });

  it('classifies the captured `authentication failed or timed out` result as auth', async () => {
    const fake = writeFakeAgy('auth-result'); dirs.push(fake);
    const { result } = await turn(input(fake));
    expect(result.error).toMatchObject({ code: 'auth', family: 'auth' });
  });
});

describe('agy login-failure text (VS-995, captured from 1.5.14)', () => {
  const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
  it('recognises both no-login shapes and the result error', async () => {
    const { isAuthFailureText, isAuthPrompt } = await import('../src/index.js');
    expect(fx('no-login.stderr.txt').some(isAuthPrompt)).toBe(true);
    expect(fx('no-login-fast.stderr.txt').every((l) => isAuthFailureText(l))).toBe(true);
    const result = JSON.parse(fx('no-login-result.jsonl')[0]!) as { result: { error: string } };
    expect(isAuthFailureText(result.result.error)).toBe(true);
    expect(isAuthFailureText('Authentication expired. Please log back in.')).toBe(true);
    expect(isAuthFailureText('rate limited (429)')).toBe(false);
  });
});

describe('agy adapter — install and detect (VS-995)', () => {
  it('installs AGENTS.md and skills where skills/manifest.json declares for agy', async () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../skills/manifest.json', import.meta.url)), 'utf8')) as { runtimes: Record<string, { path: string }> };
    expect(adapter.skillsDir()).toBe(manifest.runtimes['agy']!.path.replace(/\/<name>\/SKILL\.md$/, ''));
    const home = tmp('ac-home-');
    const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo skill\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('demo skill');
  });

  it('detect() reports a status without failing', async () => {
    const d = await adapter.detect();
    expect(['available', 'missing_binary', 'broken', 'unsupported']).toContain(d.status);
  });
});
