import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('claude adapter', () => {
  it('declares its identity, capabilities and per-CLI conventions', () => {
    expect(adapter.id).toBe('claude');
    expect(adapter.skillsDir()).toBe('.claude/skills');
    expect(adapter.instructionFiles()).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(adapter.capabilities).toMatchObject({ resumableSessions: true, forkSessions: true, structuredOutput: true, mcp: true, costReporting: true, usageReporting: 'per_turn' });
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
