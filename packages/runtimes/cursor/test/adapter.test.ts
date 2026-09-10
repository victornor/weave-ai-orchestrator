import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';
import { _resetModelsCacheForTests, FALLBACK_MODELS, listModels } from '../src/models.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); _resetModelsCacheForTests(); });

describe('cursor adapter', () => {
  it('declares cursor-agent conventions without live stdin', () => {
    expect(adapter.id).toBe('cursor');
    expect(adapter.displayName).toBe('Cursor CLI');
    expect(adapter.skillsDir()).toBe('.cursor/skills');
    expect(adapter.instructionFiles()).toEqual(['AGENTS.md']);
    expect(adapter.forkSession).toBeUndefined();
    expect(adapter.capabilities).toMatchObject({
      resumableSessions: true, forkSessions: false, streamingInput: false,
      systemPromptInjection: 'file_only', structuredOutput: false, mcp: true,
      usageReporting: 'none', costReporting: false,
    });
  });

  it('lists the real fallback catalogue, via a cache primed with no binary (never the real installed CLI)', async () => {
    await listModels({ binaryPath: null });
    const models = await adapter.listModels();
    expect(models.every((m) => m.source === 'static')).toBe(true);
    expect(models.map((m) => m.id)).toEqual(FALLBACK_MODELS.map((m) => m.id));
    expect(models.map((m) => m.id)).not.toContain('grok-4-6');
  });

  it('installs AGENTS.md, a CLAUDE.md pointer, and skills', async () => {
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(readFileSync(join(home, '.cursor/skills/demo/SKILL.md'), 'utf8')).toContain('demo');
  });

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });
});
