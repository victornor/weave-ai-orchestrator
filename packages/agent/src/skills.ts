import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from './tools/index.js';
import { errorOutput } from './tools/index.js';

export interface Skill { name: string; description: string; dir: string; file: string; /** Which configured root the skill came from (a REPL's `skillRoots`); unset for the default home. */ source?: string }
export const SKILL_BODY_MAX_BYTES = 50 * 1024;

/** `name` and `description` from a SKILL.md's frontmatter, and the body after it. A file with no name is not a skill. */
export function parseSkill(text: string): { name: string; description: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const field = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(m[1]!);
    return line ? line[1]!.trim().replace(/^(['"])(.*)\1$/, '$2') : '';
  };
  const name = field('name');
  return name ? { name, description: field('description'), body: m[2]!.trimStart() } : null;
}

/** The skills under `<home>/<skillsDir>/<name>/SKILL.md`, sorted by name so the prompt built from them is byte-stable. */
export function loadSkills(home: string, skillsDir = '.agents/skills'): Skill[] {
  return readSkillRoot(join(home, skillsDir));
}

/**
 * Skills from several roots, in the order given: on a name collision the earlier root wins. Each
 * skill carries the root's `source` label, so a listing can say where it came from.
 */
export function loadSkillRoots(roots: ReadonlyArray<{ dir: string; source: string }>): Skill[] {
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const r of roots) for (const s of readSkillRoot(r.dir)) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({ ...s, source: r.source });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readSkillRoot(root: string): Skill[] {
  if (!existsSync(root)) return [];
  const out: Skill[] = [];
  for (const entry of readdirSync(root).sort()) {
    const dir = join(root, entry); const file = join(dir, 'SKILL.md');
    try {
      if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
      const parsed = parseSkill(readFileSync(file, 'utf8'));
      if (parsed) out.push({ name: parsed.name, description: parsed.description, dir, file });
    } catch { /* unreadable: not a skill */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The system prompt section that lists the skills; empty when there are none. */
export function skillIndex(skills: readonly Skill[]): string {
  if (skills.length === 0) return '';
  return `Skills you can load with the \`skill\` tool (frontmatter only; load one before doing what it covers):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`;
}

export function skillTool(skills: readonly Skill[]): ToolDefinition {
  return {
    name: 'skill',
    description: 'Load a skill by name: returns its instructions and the directory that holds its other files, which you can open with read.',
    readOnly: true,
    parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', description: 'A name from the skills list' } } },
    async run(args) {
      const name = typeof args['name'] === 'string' ? args['name'] : '';
      const skill = skills.find((s) => s.name === name);
      if (!skill) return errorOutput(`no skill named "${name}". Available: ${skills.map((s) => s.name).join(', ') || '(none)'}`);
      const parsed = parseSkill(readFileSync(skill.file, 'utf8'));
      let body = parsed?.body ?? '';
      if (Buffer.byteLength(body) > SKILL_BODY_MAX_BYTES) body = `${Buffer.from(body).subarray(0, SKILL_BODY_MAX_BYTES).toString('utf8')}\n[truncated at ${SKILL_BODY_MAX_BYTES} bytes; read ${skill.file} for the rest]`;
      return { text: `# Skill: ${skill.name}\nDirectory: ${skill.dir}\n\n${body}` };
    },
  };
}
