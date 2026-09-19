import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The repository pull-request template locations GitHub itself honours, in the order it prefers them. */
const TEMPLATE_FILES = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'PULL_REQUEST_TEMPLATE.md',
];

/** A heading the daemon can fill with the promotion's own facts, rather than a claim it cannot make. */
const FILLABLE_HEADING = /(^|\b)(description|summary|what|change|overview|context|about)(\b|$)/i;

/** A section body the daemon cannot fill, but must not leave blank or fill with an invented claim. */
const HUMAN_CONFIRMATION = '_Requires human confirmation — the daemon cannot verify this._';

export interface PromotionBodyTicket { identifier: string; title: string }
export interface PromotionBodyInput {
  landing: string;
  defaultBranch: string;
  landingHead: string | null;
  defaultHead: string | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  tickets: PromotionBodyTicket[];
  commits: Array<{ sha: string; subject: string }>;
  notes: string[];
}

/**
 * VS-584: the repository's pull-request template, if it has one. Reads the clone's working tree; the
 * first file found at GitHub's preferred locations wins. Multiple templates under
 * `.github/PULL_REQUEST_TEMPLATE/` are not disambiguated (GitHub chooses by query parameter); the
 * first by name is used so the daemon never opens a PR with no template body at all.
 */
export function readPullRequestTemplate(clonePath: string): string | null {
  for (const rel of TEMPLATE_FILES) {
    const path = join(clonePath, rel);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, 'utf8');
      if (text.trim()) return text;
    } catch { /* unreadable is the same as absent here */ }
  }
  const dir = join(clonePath, '.github', 'PULL_REQUEST_TEMPLATE');
  if (existsSync(dir)) {
    try {
      const first = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()[0];
      if (first) {
        const text = readFileSync(join(dir, first), 'utf8');
        if (text.trim()) return text;
      }
    } catch { /* fall through to no template */ }
  }
  return null;
}

/** The daemon's own facts, stated once and used by both the fillable section and the appended section. */
function facts(input: PromotionBodyInput): string[] {
  const changed = `**Changed:** ${input.changedFiles} file${input.changedFiles === 1 ? '' : 's'}, +${input.additions}/−${input.deletions} (tree diff \`${input.defaultBranch}...${input.landing}\`)`;
  const tickets = input.tickets.length
    ? `**Tickets (${input.tickets.length}):** ${input.tickets.map((t) => `${t.identifier} ${t.title}`).join('; ')}`
    : '**Tickets:** none recorded for this range';
  return [`**Promotion:** ${input.landing} → ${input.defaultBranch}`, changed, tickets];
}

interface Section { heading: string | null; body: string[] }

function splitSections(md: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, body: [] };
  for (const line of md.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      sections.push(current);
      current = { heading: line, body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function renderSection(section: Section, input: PromotionBodyInput): string[] {
  const body = section.body.join('\n').trim();
  if (section.heading === null) return section.body;
  const headingText = section.heading.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
  if (FILLABLE_HEADING.test(headingText)) return [section.heading, '', ...facts(input)];
  if (!body) return [section.heading, '', HUMAN_CONFIRMATION];
  // A template section the daemon cannot fill but that already carries its own guidance or checklist
  // is left exactly as the repository wrote it — never blank, and never replaced by a claim.
  return [section.heading, '', ...section.body];
}

/**
 * VS-584: the body of the promotion pull request. Where the repository has a template, every heading
 * is kept; the daemon's facts replace the body only under a heading it can fill, an empty section is
 * marked for human confirmation rather than left blank, and every other section keeps the repository's
 * own text untouched. A labelled "carries" section (tickets, changed files, go-live notes, commits as
 * detail) is appended so the required content is always present even with no template.
 */
export function buildPromotionBody(input: PromotionBodyInput, template: string | null): string {
  const head: string[] = [];
  if (template?.trim()) {
    for (const section of splitSections(template)) head.push(...renderSection(section, input), '');
  } else {
    head.push(...facts(input), '');
  }
  const details: string[] = [
    '## What this promotion carries',
    '',
    `- Tickets (${input.tickets.length}): ${input.tickets.length ? input.tickets.map((t) => `${t.identifier} ${t.title}`).join('; ') : 'none recorded'}`,
    `- Changed: ${input.changedFiles} file${input.changedFiles === 1 ? '' : 's'}, +${input.additions}/−${input.deletions} (tree diff \`${input.defaultBranch}...${input.landing}\`)`,
  ];
  if (input.landingHead) details.push(`- Landing head: \`${input.landingHead.slice(0, 12)}\``);
  if (input.defaultHead) details.push(`- Default head: \`${input.defaultHead.slice(0, 12)}\``);
  if (input.notes.length) {
    details.push('', 'What going live does:', ...input.notes.map((n) => `- ${n}`));
  }
  if (input.commits.length) {
    details.push('', `Commits on ${input.landing} (detail):`, ...input.commits.slice(0, 50).map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}`));
  }
  return [...head, ...details].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
