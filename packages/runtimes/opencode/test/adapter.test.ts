import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });
}, 90_000);
