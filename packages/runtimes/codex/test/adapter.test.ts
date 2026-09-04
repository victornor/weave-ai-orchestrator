import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from '../src/adapter.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('codex adapter', () => {
  it('declares file_only prompt injection and its skills dir', () => {
    expect(adapter.id).toBe('codex');
    expect(adapter.skillsDir()).toBe('.agents/skills');
    expect(adapter.instructionFiles()).toEqual(['AGENTS.md']);
    expect(adapter.capabilities).toMatchObject({ systemPromptInjection: 'file_only', structuredOutput: true, costReporting: false, forkSessions: true });
  });

  it('lists static gpt-5 family and o-series models', async () => {
    const ids = (await adapter.listModels()).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['gpt-5', 'gpt-5-mini', 'o3', 'o4-mini']));
    expect((await adapter.listModels()).every((m) => m.source === 'static')).toBe(true);
  });

  it('installs AGENTS.md and skills', async () => {
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('demo');
  });

  it('forks lazily', async () => {
    expect(await adapter.forkSession!({ threadId: 't1' }, '/tmp')).toEqual({ threadId: 't1', fork: true });
  });

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });
});
