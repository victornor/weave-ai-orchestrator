/**
 * Detects a change whose spec delta would leave a capability with zero requirements without the
 * change's `.openspec.yaml` declaring `retire_capabilities: true` — the one fact
 * `openspec validate --strict` does not check (it validates the delta's own shape, not what its
 * merge into the main spec would leave behind), and that `openspec archive` only checks after
 * merge, when a worker can no longer push the one-line fix (VS-293).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import YAML from 'yaml';
import type { ValidationIssue } from './cli.js';

const REQUIREMENT_HEADING = /^### Requirement:/gm;
const SECTION_HEADING = /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/gm;

function countRequirements(text: string): number {
  return (text.match(REQUIREMENT_HEADING) ?? []).length;
}

/** Splits a delta file into its named sections; each section's content runs to the next `## ` heading or EOF. */
function deltaSections(body: string): Map<string, string> {
  const matches = [...body.matchAll(SECTION_HEADING)];
  const sections = new Map<string, string>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    sections.set(m[1]!, body.slice(start, end));
  }
  return sections;
}

function specDeltaFiles(specsDir: string): string[] {
  if (!existsSync(specsDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name === 'spec.md') out.push(p);
    }
  };
  walk(specsDir);
  return out;
}

function retireCapabilitiesDeclared(changeDir: string): boolean {
  const metaPath = join(changeDir, '.openspec.yaml');
  if (!existsSync(metaPath)) return false;
  try {
    const doc: unknown = YAML.parse(readFileSync(metaPath, 'utf8'));
    return Boolean(doc && typeof doc === 'object' && (doc as Record<string, unknown>).retire_capabilities === true);
  } catch { return false; }
}

/**
 * A capability's delta counts as an undeclared wholesale retirement when it would leave zero
 * requirements (survivors = current count − removed + added ≤ 0) and the change has not set
 * `retire_capabilities: true`. A `## RENAMED Requirements` section always disqualifies a
 * capability from this check — its FROM:/TO: format keeps a requirement alive under a new name,
 * which this check does not need to parse to know is never a retirement. A capability with no
 * existing main spec is being introduced, not retired, and is never flagged.
 */
export function findUndeclaredCapabilityRetirements(cwd: string, changeName: string): ValidationIssue[] {
  const changeDir = join(cwd, 'openspec', 'changes', changeName);
  const specsDir = join(changeDir, 'specs');
  const mainSpecsDir = join(cwd, 'openspec', 'specs');
  const declared = retireCapabilitiesDeclared(changeDir);
  const issues: ValidationIssue[] = [];
  for (const deltaFile of specDeltaFiles(specsDir)) {
    const capabilityId = relative(specsDir, join(deltaFile, '..')).split(sep).join('/');
    const mainSpecFile = join(mainSpecsDir, capabilityId, 'spec.md');
    if (!existsSync(mainSpecFile)) continue;
    const mainCount = countRequirements(readFileSync(mainSpecFile, 'utf8'));
    const sections = deltaSections(readFileSync(deltaFile, 'utf8'));
    if (sections.has('RENAMED')) continue;
    const removed = sections.has('REMOVED') ? countRequirements(sections.get('REMOVED')!) : 0;
    const added = sections.has('ADDED') ? countRequirements(sections.get('ADDED')!) : 0;
    const survivors = mainCount - removed + added;
    if (survivors > 0 || declared) continue;
    issues.push({
      level: 'error',
      message: `'${capabilityId}' loses its last requirement in this change, which would leave its spec empty. Add \`retire_capabilities: true\` to the change's .openspec.yaml to retire the capability, or keep at least one requirement.`,
      path: relative(cwd, deltaFile).split(sep).join('/'),
    });
  }
  return issues;
}
