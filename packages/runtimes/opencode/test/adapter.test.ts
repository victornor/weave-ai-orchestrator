import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';

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

describe('opencode adapter', () => {
  it('declares no native structured output', () => {
    expect(adapter.id).toBe('opencode');
    expect(adapter.skillsDir()).toBe('.opencode/skills');
    expect(adapter.instructionFiles()).toEqual(['AGENTS.md']);
    expect(adapter.capabilities).toMatchObject({ structuredOutput: false, systemPromptInjection: 'file_only', mcp: true });
  });

  it('detects models from `opencode models`, falling back to a static list', async () => {
    const models = await adapter.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.id.includes('/'))).toBe(true);
    expect(['detected', 'static']).toContain(models[0]!.source);
  });

  it('installs AGENTS.md, skills and a placeholder opencode.json', async () => {
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.opencode/skills/demo/SKILL.md'), 'utf8')).toContain('demo');
    expect(JSON.parse(readFileSync(join(home, '.opencode/opencode.json'), 'utf8')).$schema).toBe('https://opencode.ai/config.json');
  });

  it('installs skills at the path skills/manifest.json declares for opencode (VS-189)', async () => {
    expect(adapter.skillsDir()).toBe(skillsDirFromManifest('opencode'));
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, skillsDirFromManifest('opencode'), 'demo', 'SKILL.md'), 'utf8')).toContain('demo');
  });

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });
}, 90_000);
