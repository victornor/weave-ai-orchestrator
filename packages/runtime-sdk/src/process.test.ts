import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { classifyError, planSpawn, resolveSpawnTarget, spawnLines, type SpawnProc } from './process.js';

const fixture = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8').trim();

const VS234_CAPTURE = fixture('vs-234-opencode.txt');
// Real ActionRequiredError text from a cursor-agent run that failed out of usage (VS-251).
const VS251_CURSOR_CAPTURE = fixture('vs-251-cursor-action-required.txt');
// Confirmed real codex CLI text (also used by reset.test.ts's parseResetTime cases).
const CODEX_USAGE_LIMIT_CAPTURE = fixture('codex-youve-hit-your-usage-limit.txt');
// Extracted via `strings` on the installed Claude Code binary (VS-251) — the CLI's own literal,
// not a guess; the surrounding sentence (e.g. a reset time) is not captured, only this phrase.
const CLAUDE_USAGE_LIMIT_CAPTURE = fixture('vs-251-claude-usage-limit-reached.txt');

const ECHO_SCRIPT = "process.stdin.setEncoding('utf8'); process.stdin.on('data', c => process.stdout.write(c.split('\\n').filter(Boolean).map(l => 'echo:' + l + '\\n').join(''))); process.stdin.on('end', () => process.exit(0));";

describe('spawnLines stdin modes', () => {
  it("'close' mode (default) ends stdin immediately, as before", async () => {
    const lines: string[] = [];
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', ECHO_SCRIPT], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdin: 'hello\n', timeoutMs: 5000, onLine: (s, l) => { if (s === 'stdout') lines.push(l); },
    });
    const outcome = await run.done;
    expect(outcome.exitCode).toBe(0);
    expect(lines).toEqual(['echo:hello']);
  });

  it("'open' mode keeps stdin writable across two separate writes", async () => {
    const lines: string[] = [];
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', ECHO_SCRIPT], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdinMode: 'open', timeoutMs: 5000, onLine: (s, l) => { if (s === 'stdout') lines.push(l); },
    });
    expect(run.write('first\n')).toBe(true);
    await vi.waitFor(() => { expect(lines).toEqual(['echo:first']); }, { timeout: 2000, interval: 10 });
    expect(run.write('second\n')).toBe(true);
    await vi.waitFor(() => { expect(lines).toEqual(['echo:first', 'echo:second']); }, { timeout: 2000, interval: 10 });
    run.endStdin();
    const outcome = await run.done;
    expect(outcome.exitCode).toBe(0);
  });

  it('a write after the child exits returns false rather than throwing', async () => {
    const run = spawnLines({
      cmd: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), env: process.env as Record<string, string>,
      stdinMode: 'open', timeoutMs: 5000, onLine: () => {},
    });
    await run.done;
    expect(() => run.write('too late\n')).not.toThrow();
    expect(run.write('too late\n')).toBe(false);
  });
});

describe('classifyError', () => {
  it('preserves a realistically long, structured message intact (VS-201)', () => {
    const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
    const stderr = `Cannot use this model: grok-4-6. Available models: ${models}`;
    expect(stderr.length).toBeLessThan(4000);
    const err = classifyError(1, stderr);
    expect(err?.message).toBe(stderr);
    expect(err?.message).toContain(`gpt-5.59-sol-high`);
  });

  it('marks a message longer than the generous limit instead of cutting it silently', () => {
    const stderr = `x`.repeat(5000);
    const err = classifyError(1, stderr);
    expect(err?.message.length).toBeLessThan(5000);
    expect(err?.message).toMatch(/…\[\+\d+ chars\]$/);
  });

  it('keeps the provider quota text so a reset timestamp survives classification (VS-238)', () => {
    const err = classifyError(1, VS234_CAPTURE);
    expect(err?.family).toBe('provider_quota');
    expect(err?.code).toBe('provider_quota');
    expect(err?.message).toContain('Your limit will reset at 2026-09-12 01:54:35');
    expect(err?.message).not.toBe('provider rate limited, usage limit or quota exceeded');
  });

  it("classifies cursor-agent's real out-of-usage ActionRequiredError as provider_quota (VS-251)", () => {
    const err = classifyError(1, VS251_CURSOR_CAPTURE);
    expect(err?.family).toBe('provider_quota');
    expect(err?.code).toBe('provider_quota');
    expect(err?.message).toContain("You're out of usage");
  });

  it('classifies a quota message on an unexpected (non-1) exit code as provider_quota too (VS-251)', () => {
    const err = classifyError(2, VS251_CURSOR_CAPTURE);
    expect(err?.family).toBe('provider_quota');
    const signalExit = classifyError(null, VS251_CURSOR_CAPTURE);
    expect(signalExit?.family).toBe('provider_quota');
  });

  it('classifies codex\'s real "hit your usage limit" text as provider_quota (VS-251)', () => {
    const err = classifyError(1, CODEX_USAGE_LIMIT_CAPTURE);
    expect(err?.family).toBe('provider_quota');
  });

  it("classifies Claude Code's own captured \"Usage limit reached\" phrase as provider_quota (VS-251)", () => {
    const err = classifyError(1, CLAUDE_USAGE_LIMIT_CAPTURE);
    expect(err?.family).toBe('provider_quota');
  });

  it('does not classify a bare mention of "usage" as quota (VS-251)', () => {
    const err = classifyError(1, 'Usage: cursor-agent [options]\n\nRun with --help for more information.');
    expect(err?.family).not.toBe('provider_quota');
  });
});

describe('resolveSpawnTarget (VS-579)', () => {
  it('wraps the command in a scope when containment is requested and available', () => {
    const target = resolveSpawnTarget('/usr/bin/claude', ['-p'], { runId: 'r1', memoryMb: 2048 }, true);
    expect(target.cmd).toBe('systemd-run');
    expect(target.scopeUnit).toBe('ac-run-r1.scope');
    expect(target.args.slice(-2)).toEqual(['/usr/bin/claude', '-p']);
    expect(target.args.join(' ')).toContain('MemoryMax=2048M');
  });

  it('spawns the command unchanged when containment is off or unavailable', () => {
    expect(resolveSpawnTarget('/usr/bin/claude', ['-p'], { runId: 'r1', memoryMb: 2048 }, false)).toEqual({ cmd: '/usr/bin/claude', args: ['-p'], scopeUnit: null });
    expect(resolveSpawnTarget('/usr/bin/claude', ['-p'], undefined, true)).toEqual({ cmd: '/usr/bin/claude', args: ['-p'], scopeUnit: null });
  });
});

describe('planSpawn containment env (VS-640)', () => {
  it('gives the wrapper the user-bus vars while the command env keeps only the allowlist', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user', LANG: 'C.UTF-8', TMPDIR: '/tmp' };
    const plan = planSpawn({
      cmd: '/usr/bin/node', args: ['agent.js'], env, available: true, containment: { runId: 'r1', memoryMb: 2048 },
      containmentEnv: { XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
    });
    expect(plan.cmd).toBe('systemd-run');
    expect(plan.scopeUnit).toBe('ac-run-r1.scope');
    expect(plan.env).toEqual({ ...env, XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' });
    expect(plan.agentEnv).toEqual(env);
    expect(plan.agentEnv).not.toHaveProperty('XDG_RUNTIME_DIR');
    const i = plan.args.indexOf('env');
    expect(plan.args.slice(i, i + 5)).toEqual(['env', '-u', 'XDG_RUNTIME_DIR', '-u', 'DBUS_SESSION_BUS_ADDRESS']);
    expect(plan.args.slice(-2)).toEqual(['/usr/bin/node', 'agent.js']);
  });

  it('adds no bus variable and no env -u when containment is off or unavailable', () => {
    const env = { PATH: '/usr/bin' };
    const off = planSpawn({ cmd: '/usr/bin/node', args: ['a.js'], env, available: true, containmentEnv: { XDG_RUNTIME_DIR: '/run/user/1000' } });
    expect(off).toEqual({ cmd: '/usr/bin/node', args: ['a.js'], env, agentEnv: env, scopeUnit: null });
    const unavailable = planSpawn({ cmd: '/usr/bin/node', args: ['a.js'], env, available: false, containment: { runId: 'r', memoryMb: 1 }, containmentEnv: { XDG_RUNTIME_DIR: '/run/user/1000' } });
    expect(unavailable).toEqual({ cmd: '/usr/bin/node', args: ['a.js'], env, agentEnv: env, scopeUnit: null });
  });
});

describe('spawnLines containment failure (VS-640)', () => {
  const bus = fixture('vs-639-systemd-run-user-bus.txt');
  const script = `process.stderr.write(${JSON.stringify(bus + '\n')}); process.exit(1);`;
  // A stand-in for systemd-run: it fails before starting the command, writing the real bus text.
  const fakeSpawn: SpawnProc = ((_cmd: string, _args: string[], options: Parameters<typeof spawn>[2]) => spawn(process.execPath, ['-e', script], options)) as SpawnProc;
  const opts = { cmd: process.execPath, args: ['-e', '0'], cwd: process.cwd(), env: process.env as Record<string, string>, timeoutMs: 5000, onLine: () => {}, containment: { runId: 'r1', memoryMb: 512 }, containmentEnv: { XDG_RUNTIME_DIR: '/run/user/1000' }, spawnProc: fakeSpawn };

  it('flags a wrapped wrapper that could not reach the user manager', async () => {
    const run = spawnLines({ ...opts, scopeAvailable: true });
    const outcome = await run.done;
    expect(run.scopeUnit).toBe('ac-run-r1.scope');
    expect(outcome.containmentFailed).toBe(true);
  });

  it('does not flag the same stderr when nothing was wrapped', async () => {
    const run = spawnLines({ ...opts, scopeAvailable: false });
    const outcome = await run.done;
    expect(run.scopeUnit).toBeNull();
    expect(outcome.containmentFailed).toBe(false);
  });
});
