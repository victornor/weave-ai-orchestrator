import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial, TurnInput } from '@weave-ai/runtime-sdk';
import { adapter } from '../src/adapter.js';
import { writeFakeClaudeCli, writeFakeClaudeCompactCli } from './fakeCli.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** `skills/manifest.json`'s `runtimes.<id>.path` is `<skillsDir>/<name>/SKILL.md`; strip the suffix. */
const skillsDirFromManifest = (runtimeId: string): string => {
  const manifestPath = fileURLToPath(new URL('../../../../skills/manifest.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { runtimes: Record<string, { path: string }> };
  const path = manifest.runtimes[runtimeId]?.path;
  if (!path) throw new Error(`skills/manifest.json has no runtimes.${runtimeId} entry`);
  return path.replace(/\/<name>\/SKILL\.md$/, '');
};

describe('claude adapter', () => {
  it('requires a compact boundary from the command output, not only exit status', async () => {
    const boundaryDir = writeFakeClaudeCompactCli({ boundary: true });
    dirs.push(boundaryDir);
    const success = await adapter.compactSession!({
      ref: { sessionId: 'fake-compact-session' }, cwd: tmp('ac-compact-cwd-'),
      env: { PATH: `${boundaryDir}:${process.env['PATH'] ?? ''}` },
    });
    expect(success).toMatchObject({ ok: true, via: 'command' });

    const noBoundaryDir = writeFakeClaudeCompactCli({ boundary: false });
    dirs.push(noBoundaryDir);
    const failure = await adapter.compactSession!({
      ref: { sessionId: 'fake-compact-session' }, cwd: tmp('ac-compact-cwd-'),
      env: { PATH: `${noBoundaryDir}:${process.env['PATH'] ?? ''}` },
    });
    expect(failure).toMatchObject({ ok: false, via: 'command', detail: { boundary: false, isError: false } });
    expect(failure.error?.message).toContain('compact boundary');
  });

  it('declares its identity, capabilities and per-CLI conventions', () => {
    expect(adapter.id).toBe('claude');
    expect(adapter.skillsDir()).toBe('.claude/skills');
    expect(adapter.instructionFiles()).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(adapter.capabilities).toMatchObject({ resumableSessions: true, forkSessions: true, structuredOutput: true, mcp: true, costReporting: true, usageReporting: 'per_turn' });
    expect(adapter.capabilities.imageInput).toBe('native');
  });

  it('declares full partial output and the shared table agrees (VS-599)', () => {
    expect(adapter.capabilities.partialOutput).toBe('full');
  });

  it('declares its own in-process scheduling tools to deny on worker turns (VS-317)', () => {
    expect(adapter.workerDeniedTools).toEqual(['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']);
  });

  it('exposes a config schema covering the per-role options', () => {
    const props = (adapter.configSchema() as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['model', 'effort', 'permissionMode', 'maxTurns', 'maxBudgetUsd', 'extraArgs']));
  });

  it('lists the aliases and pinned ids as static models', async () => {
    const models = await adapter.listModels();
    expect(models.every((m) => m.source === 'static' && m.provider === 'anthropic')).toBe(true);
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['fable', 'opus', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']));
  });

  it('declares per-model thinking levels from the 2.1.266 catalog, not the five-value configSchema enum', async () => {
    const models = await adapter.listModels();
    const of = (id: string) => models.find((m) => m.id === id)?.efforts;
    expect(of('claude-fable-5-1')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(of('claude-opus-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(of('claude-sonnet-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(of('haiku')).toEqual([]);
    expect(of('claude-haiku-4-5-20251001')).toEqual([]);
    expect(of('haiku')).not.toContain('xhigh');
    expect(of('haiku')).not.toContain('max');
    const schemaEffort = (adapter.configSchema() as { properties: { effort: { enum: string[] } } }).properties.effort.enum;
    expect(schemaEffort).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(models.some((m) => JSON.stringify(m.efforts) === JSON.stringify(schemaEffort) && m.id.includes('haiku'))).toBe(false);
  });

  it('declares each model’s own context window rather than one constant for all of them (VS-129)', async () => {
    const windowOf = async (id: string) => (await adapter.listModels()).find((m) => m.id === id)?.contextWindowTokens;
    // fable/opus/sonnet and their pinned -5/-5-1 ids resolve to natively 1M-context models; only
    // haiku is genuinely 200k. See design.md on VS-129 for the per-model evidence.
    for (const id of ['fable', 'opus', 'sonnet', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5']) {
      expect(await windowOf(id)).toBe(1_000_000);
    }
    for (const id of ['haiku', 'claude-haiku-4-5-20251001']) {
      expect(await windowOf(id)).toBe(200_000);
    }
  });

  it('installs CLAUDE.md as an @AGENTS.md pointer, plus skills and settings', async () => {
    const home = tmp('ac-home-');
    const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo skill\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.claude/skills/demo/SKILL.md'), 'utf8')).toContain('demo skill');
    expect(JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8')).permissions.deny).toContain('Bash(git push --force:*)');
  });

  it('installs skills at the path skills/manifest.json declares for claude (VS-189)', async () => {
    expect(adapter.skillsDir()).toBe(skillsDirFromManifest('claude'));
    const home = tmp('ac-home-');
    const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo skill\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, skillsDirFromManifest('claude'), 'demo', 'SKILL.md'), 'utf8')).toContain('demo skill');
  });

  it('forks lazily and describes sessions', async () => {
    expect(await adapter.forkSession!({ sessionId: 's1' }, '/tmp')).toEqual({ sessionId: 's1', fork: true });
    expect(await adapter.describeSession!({ sessionId: 's1' })).toEqual({ displayId: 's1', exists: true });
    expect(await adapter.describeSession!({})).toEqual({ displayId: 'unknown', exists: false });
  });

  it('detects the installed binary', async () => {
    const d = await adapter.detect();
    expect(['available', 'missing_binary', 'broken']).toContain(d.status);
    if (d.status === 'available') expect(d.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('claude adapter — headless turn streaming (VS-599)', () => {
  it('reports partials in the --input-format text form and persists only completed events', async () => {
    const fakeDir = writeFakeClaudeCli({ stream: true, assistantText: 'pong' });
    dirs.push(fakeDir);
    const events: RuntimeEvent[] = [];
    const partials: RuntimePartial[] = [];
    const input: TurnInput = {
      runId: 'run-headless', turnEpoch: 1, cwd: tmp('ac-head-'), worktree: null,
      session: { policy: 'fresh', ref: null, isFirstTurn: true },
      systemPrompt: { text: '', mode: 'skip' },
      prompt: 'do the thing', mcpServers: {},
      env: { PATH: `${fakeDir}:${process.env['PATH'] ?? ''}` },
      options: { liveInput: false }, limits: { timeoutMs: 10_000 }, permission: { mode: 'auto' },
    };
    const result = await adapter.runTurn(input, {
      onSpawn: () => undefined, onEvent: (e) => events.push(e), onRaw: () => undefined, onPartial: (p) => partials.push(p),
    });
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe('pong');
    expect(partials.map((p) => [p.kind, p.text])).toEqual([['text', 'pong']]);
    expect(events.map((e) => e.type)).toEqual(['session.started', 'assistant.text', 'usage.delta', 'turn.completed']);
    expect(events.find((e) => e.type === 'assistant.text')!.payload['partId']).toBe(partials[0]!.partId);
  });
});
