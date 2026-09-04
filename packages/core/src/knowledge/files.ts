import { createHash } from 'node:crypto';
import { estimateTokens, OcError, type KnowledgeScope } from '@agent-conductor/shared';

/** Budgets in tokens per file (PLAN §13.1). */
export const BUDGETS: Record<KnowledgeScope, number> = { workspace: 3000, shared: 800, decisions: 1500, project: 1500 };
/** Budget per linked document (PLAN §13): a topic page, not a wiki. */
export const DOC_BUDGET = 1500;

export const PROJECT_SECTIONS = ['Overview', 'Stack & commands', 'Conventions', 'Current focus', 'Landmines', 'Documents', 'Learnings'] as const;
export const WORKSPACE_SECTIONS = ['Overview', 'Goals', 'People & working style', 'Portfolio', 'Conventions', 'Standing instructions'] as const;
export const SHARED_SECTIONS = ['Conventions', 'Glossary', 'Tone'] as const;
export const DECISION_SECTIONS = ['Decisions'] as const;

export const EXPIRY_RE = /<!--\s*exp:(\d{4}-\d{2}-\d{2})\s*-->/;

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Path of a knowledge file relative to `knowledge/` (PLAN §5). */
export function relPathFor(scope: KnowledgeScope, projectSlug?: string | null): string {
  switch (scope) {
    case 'workspace': return 'workspace/WORKSPACE.md';
    case 'shared': return 'workspace/SHARED.md';
    case 'decisions': return 'workspace/decisions.md';
    case 'project':
      if (!projectSlug) throw new OcError('validation', 'the project knowledge scope needs a project');
      return `projects/${projectSlug}/PROJECT.md`;
  }
}

export interface Section { name: string; lines: string[] }
export interface Doc { preamble: string[]; sections: Section[] }

/** Split a markdown file into a preamble and its `## ` sections. Round-trips through renderDoc. */
export function parseDoc(body: string): Doc {
  const doc: Doc = { preamble: [], sections: [] };
  let current: Section | null = null;
  for (const line of body.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = { name: m[1]!, lines: [] };
      doc.sections.push(current);
    } else if (current) current.lines.push(line);
    else doc.preamble.push(line);
  }
  return doc;
}

export function renderDoc(doc: Doc): string {
  const parts: string[] = [];
  const pre = trimTrailingBlank(doc.preamble);
  if (pre.length) parts.push(pre.join('\n'));
  for (const s of doc.sections) parts.push(`## ${s.name}\n${trimTrailingBlank(s.lines).join('\n')}`);
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && out[out.length - 1]!.trim() === '') out.pop();
  while (out.length && out[0]!.trim() === '') out.shift();
  return out;
}

export function findSection(doc: Doc, name: string): Section | undefined {
  const want = name.trim().toLowerCase();
  return doc.sections.find((s) => s.name.trim().toLowerCase() === want);
}

/** Append one entry line under `section`, creating the section at the end when it is missing. */
export function appendEntry(body: string, section: string, entry: string): string {
  const doc = parseDoc(body);
  let s = findSection(doc, section);
  if (!s) {
    s = { name: section.trim(), lines: [] };
    doc.sections.push(s);
  }
  s.lines.push(entry);
  return renderDoc(doc);
}

export interface Entry { section: string; line: string; text: string; normalized: string; expires: string | null }

/** Every `- ` bullet in the document, with its section and normalized comparison form. */
export function entriesOf(body: string): Entry[] {
  const doc = parseDoc(body);
  const out: Entry[] = [];
  for (const s of doc.sections) {
    for (const line of s.lines) {
      if (!/^\s*[-*]\s+/.test(line)) continue;
      const text = line.replace(/^\s*[-*]\s+/, '').replace(/^\d{4}-\d{2}-\d{2}\s*[·:-]\s*/, '');
      out.push({ section: s.name, line, text, normalized: normalize(text), expires: EXPIRY_RE.exec(line)?.[1] ?? null });
    }
  }
  return out;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(EXPIRY_RE, ' ')
    .replace(/`[^`]*`/g, (m) => m)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dice coefficient over word bigrams, with a whole-string containment shortcut. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.95;
  const wa = a.split(' ').filter(Boolean);
  const wb = b.split(' ').filter(Boolean);
  if (wa.length < 2 || wb.length < 2) {
    const sa = new Set(wa);
    const sb = new Set(wb);
    let inter = 0;
    for (const w of sa) if (sb.has(w)) inter++;
    return (2 * inter) / (sa.size + sb.size || 1);
  }
  const bg = (w: string[]): string[] => w.slice(0, -1).map((x, i) => `${x} ${w[i + 1]}`);
  const A = bg(wa);
  const B = new Map<string, number>();
  for (const g of bg(wb)) B.set(g, (B.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of A) {
    const n = B.get(g) ?? 0;
    if (n > 0) { inter++; B.set(g, n - 1); }
  }
  return (2 * inter) / (A.length + bg(wb).length);
}

export const DUPLICATE_THRESHOLD = 0.8;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Per-section token usage plus the sections over their fair share of the budget. */
export function sectionSizes(body: string, budget: number): { sizes: Array<{ section: string; tokens: number }>; over: string[] } {
  const doc = parseDoc(body);
  const sizes = doc.sections.map((s) => ({ section: s.name, tokens: estimateTokens(`## ${s.name}\n${s.lines.join('\n')}`) }));
  const share = doc.sections.length ? budget / doc.sections.length : budget;
  return { sizes, over: sizes.filter((s) => s.tokens > share).map((s) => s.section) };
}

/** Skeletons written when a knowledge file does not exist yet. */
export function seedBody(scope: KnowledgeScope, opts: { workspaceName?: string; projectName?: string } = {}): string {
  switch (scope) {
    case 'workspace':
      return [
        `# ${opts.workspaceName ?? 'Workspace'} — workspace knowledge`,
        '',
        'Conductor-only. What this workspace is for, who works here, and the project portfolio.',
        '',
        '## Overview',
        '',
        '## Goals',
        '',
        '## People & working style',
        '',
        '## Portfolio',
        '',
        '## Conventions',
        '',
        '## Standing instructions',
        '',
      ].join('\n');
    case 'shared':
      return [
        '# Shared knowledge',
        '',
        'Read by every agent. Project-agnostic only: never name a project here.',
        '',
        '## Conventions',
        '',
        '## Glossary',
        '',
        '## Tone',
        '',
      ].join('\n');
    case 'decisions':
      return ['# Durable decisions', '', 'One line per decision the workspace should remember. Appended by the daemon.', '', '## Decisions', ''].join('\n');
    case 'project':
      return [
        `# ${opts.projectName ?? 'Project'} — project knowledge`,
        '',
        'Written by this project\'s workers and the conductor. Concise, dated, durable entries only.',
        '',
        '## Overview',
        '',
        '## Stack & commands',
        '',
        '## Conventions',
        '',
        '## Current focus',
        '',
        '## Landmines',
        '',
        '## Learnings',
        '',
      ].join('\n');
  }
}

// ---------- linked documents ----------

export const DOC_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Path of a linked document relative to `knowledge/`. `decisions` has no documents. */
export function docPathFor(scope: KnowledgeScope, slug: string, projectSlug?: string | null): string {
  if (!DOC_SLUG_RE.test(slug)) throw new OcError('validation', `document slug "${slug}" must be kebab-case (a-z, 0-9, -), 2-64 characters`);
  switch (scope) {
    case 'project':
      if (!projectSlug) throw new OcError('validation', 'a project document needs a project');
      return `projects/${projectSlug}/docs/${slug}.md`;
    case 'shared': return `workspace/shared/${slug}.md`;
    case 'workspace': return `workspace/docs/${slug}.md`;
    case 'decisions': throw new OcError('validation', 'the decisions log has no documents');
  }
}

/** Is this knowledge path a linked document (as opposed to one of the four hub files)? */
export function isDocPath(rel: string): boolean {
  return /\/docs\/[^/]+\.md$/.test(rel) || /^workspace\/shared\/[^/]+\.md$/.test(rel);
}

export function docSlugOf(rel: string): string | null {
  const m = /([^/]+)\.md$/.exec(rel);
  return isDocPath(rel) && m ? m[1]! : null;
}

/** `[[slug]]`, `[[slug|label]]` and relative markdown links to `slug.md` / `docs/slug.md`. */
export function parseLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([a-z0-9][a-z0-9-]*)(?:\|[^\]]*)?\]\]/g)) out.add(m[1]!);
  for (const m of body.matchAll(/\]\((?:\.\/)?(?:docs\/)?([a-z0-9][a-z0-9-]*)\.md\)/g)) out.add(m[1]!);
  return [...out];
}

export function docTitle(body: string): string | null {
  const m = /^#\s+(.+?)\s*$/m.exec(body);
  return m ? m[1]! : null;
}

/** First non-empty paragraph after the title, one line, for catalogues. */
export function docSummary(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i]!.trim() === '' || /^#\s/.test(lines[i]!) || /^<!--/.test(lines[i]!))) i++;
  const para: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== '' && !/^#/.test(lines[i]!)) { para.push(lines[i]!.trim()); i++; }
  return para.join(' ').replace(/\s+/g, ' ').slice(0, 240);
}
