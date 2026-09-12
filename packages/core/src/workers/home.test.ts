import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@agent-conductor/shared';
import { FakeRuntime, type RuntimeAdapter } from '@agent-conductor/runtime-sdk';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { skillsFor, renderHome, ensureHomeCurrent } from './home.js';

/** A `FakeRuntime` whose `installInstructions` is swapped for a spy, keeping every other method. */
function fakeRuntimeWithInstallSpy(install: RuntimeAdapter['installInstructions']): RuntimeAdapter {
  const runtime: RuntimeAdapter = new FakeRuntime();
  runtime.installInstructions = install;
  return runtime;
}

interface ManifestSkill { name: string; audience: 'worker' | 'weaver' | 'all' }
interface Manifest { skills: ManifestSkill[]; runtimes: Record<string, { path: string }> }

const manifest: Manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../skills/manifest.json', import.meta.url)), 'utf8'),
);

/** Seed a fake skills directory with one subdir per manifest skill, each holding a trivial SKILL.md. */
function seedSkills(ctx: TestHarness['ctx']): void {
  mkdirSync(ctx.skillsDir, { recursive: true });
  for (const s of manifest.skills) {
    const dir = join(ctx.skillsDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `# ${s.name}\n`, 'utf8');
  }
}

let h: TestHarness | undefined;
afterEach(() => h?.cleanup());

describe('skillsFor (VS-189)', () => {
  it('returns exactly the worker- and all-audience skills declared in skills/manifest.json', () => {
    h = makeHarness();
    seedSkills(h.ctx);
    const expected = manifest.skills.filter((s) => s.audience === 'worker' || s.audience === 'all').map((s) => s.name).sort();
    expect(skillsFor(h.ctx, 'worker').map((s) => s.name).sort()).toEqual(expected);
  });

  it('returns exactly the weaver- and all-audience skills, never a worker-only one', () => {
    h = makeHarness();
    seedSkills(h.ctx);
    const expected = manifest.skills.filter((s) => s.audience === 'weaver' || s.audience === 'all').map((s) => s.name).sort();
    expect(skillsFor(h.ctx, 'weaver').map((s) => s.name).sort()).toEqual(expected);
  });
});

describe('ensureHomeCurrent re-renders on a runtime change (VS-189)', () => {
  it('re-renders and installs skills through the newly-resolved runtime when the runtime changes', async () => {
    h = makeHarness();
    seedSkills(h.ctx);
    const claudeInstall = vi.fn(async () => undefined);
    const opencodeInstall = vi.fn(async () => undefined);
    h.ctx.registries.runtimes.set('claude', fakeRuntimeWithInstallSpy(claudeInstall));
    h.ctx.registries.runtimes.set('opencode', fakeRuntimeWithInstallSpy(opencodeInstall));

    const workerId = h.addWorker(null, { runtimeId: 'claude' });
    let agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;

    const first = await ensureHomeCurrent(h.ctx, h.deps, agent);
    expect(first.rerendered).toBe(true);
    expect(claudeInstall).toHaveBeenCalledTimes(1);

    // Nothing changed: the second call must not re-render or re-install.
    agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
    const second = await ensureHomeCurrent(h.ctx, h.deps, agent);
    expect(second.rerendered).toBe(false);
    expect(claudeInstall).toHaveBeenCalledTimes(1);

    // The agent's resolved runtime moves to opencode (settings changed, daemon overlay, etc.) —
    // the same way engine.ts corrects agent.runtimeId before calling ensureHomeCurrent every turn.
    h.db.update('agents', workerId, { runtimeId: 'opencode' });
    agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
    const third = await ensureHomeCurrent(h.ctx, h.deps, agent);
    expect(third.rerendered).toBe(true);
    expect(opencodeInstall).toHaveBeenCalledTimes(1);
  });

  it('treats a marker written before this fix (no runtimeId at all) as a mismatch and self-heals once', async () => {
    h = makeHarness();
    seedSkills(h.ctx);
    const install = vi.fn(async () => undefined);
    h.ctx.registries.runtimes.set('claude', fakeRuntimeWithInstallSpy(install));

    const workerId = h.addWorker(null, { runtimeId: 'claude' });
    const agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;

    // Simulate a home rendered by the pre-fix code: AGENTS.md exists, marker has no runtimeId.
    mkdirSync(agent.homePath, { recursive: true });
    writeFileSync(join(agent.homePath, 'AGENTS.md'), '# stale\n', 'utf8');
    writeFileSync(
      join(agent.homePath, '.ac-render.json'),
      JSON.stringify({ briefRevision: agent.briefRevision, specRevision: 1, roleRevision: null, renderedAt: new Date().toISOString() }),
      'utf8',
    );

    const result = await ensureHomeCurrent(h.ctx, h.deps, agent);
    expect(result.rerendered).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
    expect(existsSync(join(agent.homePath, '.claude/skills', 'agent-conductor-worker', 'SKILL.md'))).toBe(false); // FakeRuntime install is a spy, not a real writer
  });
});

describe('renderHome installs skills at the manifest path for a given runtime (VS-189)', () => {
  it('claude and opencode both resolve through skillsFor into runtime.installInstructions', async () => {
    h = makeHarness();
    seedSkills(h.ctx);
    const seen: Record<string, string[]> = {};
    for (const runtimeId of ['claude', 'opencode']) {
      seen[runtimeId] = [];
      h.ctx.registries.runtimes.set(runtimeId, fakeRuntimeWithInstallSpy(async (_home, bundle) => {
        seen[runtimeId]!.push(...bundle.skills.map((s) => s.name));
      }));
    }

    for (const runtimeId of ['claude', 'opencode']) {
      const workerId = h.addWorker(null, { runtimeId });
      const agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
      await renderHome(h.ctx, h.deps, agent);
      const expected = manifest.skills.filter((s) => s.audience === 'worker' || s.audience === 'all').map((s) => s.name).sort();
      expect(seen[runtimeId]!.sort()).toEqual(expected);
    }
  });
});
