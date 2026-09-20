import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkills, parseSkill, skillIndex, skillTool } from './skills.js';
import type { ToolCtx } from './tools/index.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'wa-skills-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));
function skill(name: string, description: string, body: string): void {
  const dir = join(home, '.agents', 'skills', name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}

describe('skills', () => {
  it('parses the frontmatter and body', () => {
    expect(parseSkill('---\nname: x\ndescription: "Does a thing"\n---\n\n# Body\ntext')).toEqual({ name: 'x', description: 'Does a thing', body: '# Body\ntext' });
    expect(parseSkill('no frontmatter')).toBeNull();
    expect(parseSkill('---\ndescription: nameless\n---\nbody')).toBeNull();
  });
  it('lists skills sorted by name and builds a stable index', () => {
    skill('zeta', 'last', 'Z'); skill('alpha', 'first', 'A');
    mkdirSync(join(home, '.agents', 'skills', 'empty'), { recursive: true });
    const skills = loadSkills(home);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(skillIndex(skills)).toBe(skillIndex(loadSkills(home)));
    expect(skillIndex(skills)).toContain('- alpha: first\n- zeta: last');
    expect(skillIndex([])).toBe('');
    expect(loadSkills(join(home, 'nowhere'))).toEqual([]);
  });
  it('the skill tool returns the body and the directory, and names the options on a miss', async () => {
    skill('alpha', 'first', 'DO THE THING');
    const tool = skillTool(loadSkills(home));
    const ok = await tool.run({ name: 'alpha' }, {} as ToolCtx);
    expect(ok.text).toContain('# Skill: alpha');
    expect(ok.text).toContain(`Directory: ${join(home, '.agents', 'skills', 'alpha')}`);
    expect(ok.text).toContain('DO THE THING');
    expect(ok.text).not.toContain('description:');
    const miss = await tool.run({ name: 'nope' }, {} as ToolCtx);
    expect(miss).toMatchObject({ isError: true });
    expect(miss.text).toContain('Available: alpha');
  });
});
