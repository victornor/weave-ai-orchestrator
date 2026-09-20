import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('gemini adapter', () => {
  it('declares GEMINI.md discovery and no session forking', () => {
    expect(adapter.id).toBe('gemini');
    expect(adapter.skillsDir()).toBe('.gemini/skills');
    expect(adapter.instructionFiles()).toEqual(['GEMINI.md']);
    expect(adapter.capabilities).toMatchObject({ forkSessions: false, structuredOutput: false, systemPromptInjection: 'file_only' });
    expect(adapter.forkSession).toBeUndefined();
  });

  it('declares text partial output and pins it to the page coverage table (VS-600)', () => {
    expect(adapter.capabilities.partialOutput).toBe('text');
  });

  it('lists static google models with no thinking levels', async () => {
    const models = await adapter.listModels();
    expect(models.every((m) => m.source === 'static' && m.provider === 'google')).toBe(true);
    expect(models.map((m) => m.id)).toContain('gemini-2.5-pro');
    expect(models.every((m) => Array.isArray(m.efforts) && m.efforts.length === 0)).toBe(true);
  });

  it('installs GEMINI.md, skills and a placeholder settings.json', async () => {
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'GEMINI.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.gemini/skills/demo/SKILL.md'), 'utf8')).toContain('demo');
    expect(JSON.parse(readFileSync(join(home, '.gemini/settings.json'), 'utf8')).mcpServers).toEqual({});
  });

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });
});
