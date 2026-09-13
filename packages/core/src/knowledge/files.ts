import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_KNOWLEDGE_BUDGETS, estimateTokens, OcError, type KnowledgeBudgets, type KnowledgeScope } from '@weave-ai/shared';

/**
 * Budgets in tokens per file (PLAN §13.1). These are the defaults a workspace that has not set
 * `defaults.knowledgeBudgetTokens` runs on; the configured value is what the service enforces.
 */
export const BUDGETS: Record<KnowledgeScope, number> = {
  workspace: DEFAULT_KNOWLEDGE_BUDGETS.workspace, shared: DEFAULT_KNOWLEDGE_BUDGETS.shared,
  decisions: DEFAULT_KNOWLEDGE_BUDGETS.decisions, project: DEFAULT_KNOWLEDGE_BUDGETS.project,
};
/** Budget per linked document (PLAN §13): a topic page, not a wiki. */
export const DOC_BUDGET = DEFAULT_KNOWLEDGE_BUDGETS.document;
/**
 * PLAN §13.4: a knowledge file past this share of its budget is due for curation. The knowledge
 * service records that verdict on the row as it writes; the supervisor re-derives it from the same
 * fraction, so both have to read it from here.
 */
export const CURATION_BUDGET_FRACTION = 0.8;
/**
 * VS-102: a linked document nobody has written to in this long is flagged stale on the knowledge
 * health view. Deliberately not §13.4's 14-day hub staleness — a hub file changes constantly, so 14
 * days of silence is unusual; a document holding a design rationale going quiet for a season is
 * normal, and only worth a flag well past that. This is a health signal, not a curation trigger:
 * nothing is rewritten, archived or rejected because of it.
 */
export const DOCUMENT_STALE_MS = 90 * 24 * 60 * 60 * 1000;

/** The budget a hub file or a document gets from a workspace's configured budgets. */
export function budgetOf(budgets: KnowledgeBudgets, scope: KnowledgeScope, isDoc: boolean): number {
  return isDoc ? budgets.document : budgets[scope];
}

export const PROJECT_SECTIONS = ['Overview', 'Stack & commands', 'Conventions', 'Current focus', 'Landmines', 'Documents', 'Learnings'] as const;
export const WORKSPACE_SECTIONS = ['Overview', 'Goals', 'People & working style', 'Portfolio', 'Conventions', 'Standing instructions'] as const;
export const SHARED_SECTIONS = ['Conventions', 'Glossary', 'Tone'] as const;
export const DECISION_SECTIONS = ['Decisions'] as const;

export const EXPIRY_RE = /<!--\s*exp:(\d{4}-\d{2}-\d{2})\s*-->/;

/** A provider-key-shaped token, a PEM private key block, or a credentialed URL (VS-358: shared by `note()` and `putDoc`). */
export const SECRET_SHAPED_RE = /(?:sk|ghp|xox[bp])-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/]+:[^\s@/]+@/i;

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

/**
 * VS-358: the single enforcement point for the repo-write boundary. Maps a knowledge-store-relative
 * path (as `relPathFor`/`docPathFor` produce it) to its path under a project repo's `.weave/knowledge/`
 * — but only when `rel` actually belongs to that project's own `project` scope. Anything else
 * (a workspace-scope file, the shared file, the decisions log, or another project's path) throws
 * rather than producing a path, so a caller can never be tricked into writing outside its own project's
 * `knowledge/projects/<projectSlug>/**` into a repo.
 */
export function repoKnowledgePath(rel: string, projectSlug: string): string {
  const prefix = `projects/${projectSlug}/`;
  if (!rel.startsWith(prefix)) {
    throw new OcError('internal', `knowledge path ${rel} is not under ${prefix}; refusing to write it into a repo`, { rel, projectSlug });
  }
  return rel.slice(prefix.length);
}

/**
 * VS-358: a worktree's own current copy of a mirrored knowledge file, under `.weave/knowledge/`. A
 * worker's mirror write is computed against this — never against the shared workspace body, which may
 * already carry another ticket's or the weaver's unmerged edit — so `seed` (the workspace's own seed
 * body, or `''` for a document) only applies the first time a project's knowledge reaches this worktree.
 */
export function readMirrorFile(worktreePath: string, repoRelPath: string, seed: string): string {
  const abs = join(worktreePath, '.weave', 'knowledge', repoRelPath);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : seed;
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

const FILL_IN_HINT = /^\([^)]*\)\s*$/;

/**
 * True when a hub file has no section entries: after stripping HTML comments, every `##`
 * section is empty of non-blank lines that are not parenthetical fill-in hints. Title and
 * headings do not count. Wiki-links are the caller's problem — this looks at the body only.
 */
export function isHubStub(body: string): boolean {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '');
  for (const s of parseDoc(stripped).sections) {
    for (const line of s.lines) {
      const t = line.trim();
      if (t && !FILL_IN_HINT.test(t)) return false;
    }
  }
  return true;
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

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Undo the HTML escaping a coding CLI can introduce into a tool argument on its way to us,
 * so a section asked for as `Stack &amp; commands` still matches the heading `Stack & commands`.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/** The form a section name is stored and compared in: entity-decoded, single-spaced, trimmed. */
export function canonicalSection(name: string): string {
  return decodeEntities(name).replace(/\s+/g, ' ').trim();
}

export function findSection(doc: Doc, name: string): Section | undefined {
  const want = canonicalSection(name).toLowerCase();
  return doc.sections.find((s) => canonicalSection(s.name).toLowerCase() === want);
}

/** Append one entry line under `section`, creating the section at the end when it is missing. */
export function appendEntry(body: string, section: string, entry: string): string {
  const doc = parseDoc(body);
  let s = findSection(doc, section);
  if (!s) {
    s = { name: canonicalSection(section), lines: [] };
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

/**
 * VS-358: a three-way merge of a hub/entry-shaped file at bullet granularity, for merge-time
 * reconciliation (`knowledge-repo/merge-sync`). `base` is the file's content before this landing,
 * `landed` is its content after, `workspace` is the daemon's current copy — which may already hold
 * entries `landed` never saw (another ticket's still-unmerged note, a pending weaver PR). The result
 * is `workspace` plus whatever `landed` genuinely added relative to `base`, minus whatever `landed`
 * genuinely removed relative to `base` — an entry present only in `workspace` is always kept.
 */
export function mergeEntries(base: string, landed: string, workspace: string): string {
  const baseEntries = entriesOf(base);
  const landedEntries = entriesOf(landed);
  const baseNorms = new Set(baseEntries.map((e) => e.normalized));
  const landedNorms = new Set(landedEntries.map((e) => e.normalized));
  const workspaceNorms = new Set(entriesOf(workspace).map((e) => e.normalized));
  const removedNorms = new Set(baseEntries.filter((e) => !landedNorms.has(e.normalized)).map((e) => e.normalized));

  const doc = parseDoc(workspace);
  for (const s of doc.sections) {
    s.lines = s.lines.filter((line) => {
      if (!/^\s*[-*]\s+/.test(line)) return true;
      const text = line.replace(/^\s*[-*]\s+/, '').replace(/^\d{4}-\d{2}-\d{2}\s*[·:-]\s*/, '');
      return !removedNorms.has(normalize(text));
    });
  }
  let next = renderDoc(doc);
  for (const e of landedEntries) {
    if (baseNorms.has(e.normalized) || workspaceNorms.has(e.normalized)) continue;
    next = appendEntry(next, e.section, e.line.trimEnd());
  }
  return next;
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

/** A title, a one-line blurb and one empty heading per canonical section, in order. */
function skeleton(title: string, blurb: string, sections: readonly string[], budget: number): string {
  return [title, '', `<!-- ${blurb} Budget ${budget} tokens. -->`, ...sections.flatMap((s) => ['', `## ${s}`]), ''].join('\n');
}

/** Skeletons written when a knowledge file does not exist yet. */
export function seedBody(scope: KnowledgeScope, opts: { workspaceName?: string; projectName?: string; budgetTokens?: number } = {}): string {
  const budget = opts.budgetTokens ?? BUDGETS[scope];
  switch (scope) {
    case 'workspace':
      return skeleton(`# ${opts.workspaceName ?? 'Workspace'} — workspace knowledge`, 'Weaver-only. What this workspace is for, who works here, and the project portfolio.', WORKSPACE_SECTIONS, budget);
    case 'shared':
      return skeleton('# Shared knowledge', 'Read by every agent. Project-agnostic only: never name a project here.', SHARED_SECTIONS, budget);
    case 'decisions':
      return skeleton('# Durable decisions', 'One line per decision the workspace should remember. Appended by the daemon.', DECISION_SECTIONS, budget);
    case 'project':
      return skeleton(`# ${opts.projectName ?? 'Project'} — project knowledge`, 'Written by this project\'s workers and the conductor. Concise, dated, durable entries only.', PROJECT_SECTIONS, budget);
  }
}

/** `Budget N tokens` inside an HTML comment; the number is the only part rewritten. */
const BUDGET_MARKER = /(\bBudget:?\s+)([\d,]+)(\s+tokens\b)/i;

/**
 * Restate the budget in a file's leading `<!-- … Budget N tokens … -->` marker. That line sits inside
 * the knowledge base, so it reaches every agent: a stale number tells them a limit nobody enforces.
 * Only the digits change, only in the preamble's first comment, and only when they disagree.
 */
export function withBudgetStated(body: string, budget: number): string {
  const head = body.split(/^##\s/m)[0] ?? '';
  const comment = /<!--[\s\S]*?-->/.exec(head);
  if (!comment) return body;
  const updated = comment[0].replace(BUDGET_MARKER, (_all, pre: string, _n: string, post: string) => `${pre}${budget}${post}`);
  if (updated === comment[0]) return body;
  return body.slice(0, comment.index) + updated + body.slice(comment.index + comment[0].length);
}

// ---------- linked documents ----------

export const DOC_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * A folder is one or more `/`-separated segments, each shaped like a slug (kebab-case, 2-64 chars).
 * That segment shape rules out a leading, trailing or doubled `/` and a `.`/`..` segment by
 * construction — there is no separate check for those (VS-265).
 */
export const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,63}(?:\/[a-z0-9][a-z0-9-]{1,63})*$/;

/** Path of a linked document relative to `knowledge/`. `decisions` has no documents. */
export function docPathFor(scope: KnowledgeScope, slug: string, projectSlug?: string | null, folder?: string | null): string {
  if (!DOC_SLUG_RE.test(slug)) throw new OcError('validation', `document slug "${slug}" must be kebab-case (a-z, 0-9, -), 2-64 characters`);
  if (folder && !FOLDER_RE.test(folder)) {
    throw new OcError('validation', `document folder "${folder}" must be one or more kebab-case segments (a-z, 0-9, -, 2-64 characters each) separated by /`);
  }
  const dir = folder ? `${folder}/` : '';
  switch (scope) {
    case 'project':
      if (!projectSlug) throw new OcError('validation', 'a project document needs a project');
      return `projects/${projectSlug}/docs/${dir}${slug}.md`;
    case 'shared': return `workspace/shared/${dir}${slug}.md`;
    case 'workspace': return `workspace/docs/${dir}${slug}.md`;
    case 'decisions': throw new OcError('validation', 'the decisions log has no documents');
  }
}

/** Is this knowledge path a linked document (as opposed to one of the four hub files)? Any folder depth (VS-265). */
export function isDocPath(rel: string): boolean {
  return /\/docs\/(?:[^/]+\/)*[^/]+\.md$/.test(rel) || /^workspace\/shared\/(?:[^/]+\/)*[^/]+\.md$/.test(rel);
}

export function docSlugOf(rel: string): string | null {
  const m = /([^/]+)\.md$/.exec(rel);
  return isDocPath(rel) && m ? m[1]! : null;
}

/** The folder segment of a document's path, or `null` when it sits flat under `docs/` (VS-265). */
export function docFolderOf(rel: string): string | null {
  if (!isDocPath(rel)) return null;
  const m = /\/docs\/((?:[^/]+\/)*)[^/]+\.md$/.exec(rel) ?? /^workspace\/shared\/((?:[^/]+\/)*)[^/]+\.md$/.exec(rel);
  const folder = m?.[1]?.replace(/\/$/, '') ?? '';
  return folder || null;
}

/** Blank out inline code spans on one line, keeping the prose around them. */
function stripInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { out += line[i]!; i++; continue; }
    let n = 0;
    while (line[i + n] === '`') n++;
    // CommonMark: a code span closes on a backtick run of exactly the same length.
    let j = i + n;
    let end = -1;
    while (j < line.length) {
      if (line[j] !== '`') { j++; continue; }
      let k = 0;
      while (line[j + k] === '`') k++;
      if (k === n) { end = j; break; }
      j += k;
    }
    if (end === -1) { out += line.slice(i, i + n); i += n; continue; } // unmatched run: literal backticks
    out += ' ';
    i = end + n;
  }
  return out;
}

/** Blank out fenced code blocks and inline code spans so links inside them are not matched. */
function stripCode(body: string): string {
  let fence: string | null = null;
  return body
    .split('\n')
    .map((line) => {
      if (fence) {
        if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},} *$`).test(line)) fence = null;
        return '';
      }
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) { fence = open[1]!; return ''; }
      return stripInlineCode(line);
    })
    .join('\n');
}

/**
 * `[[slug]]`, `[[slug|label]]` and relative markdown links to `slug.md` / `docs/slug.md`.
 * Code spans and fenced code blocks are ignored, so a document that documents the link
 * syntax does not report its own examples as links.
 */
export function parseLinks(body: string): string[] {
  const out = new Set<string>();
  const prose = stripCode(body);
  for (const m of prose.matchAll(/\[\[([a-z0-9][a-z0-9-]*)(?:\|[^\]]*)?\]\]/g)) out.add(m[1]!);
  for (const m of prose.matchAll(/\]\((?:\.\/)?(?:docs\/)?([a-z0-9][a-z0-9-]*)\.md\)/g)) out.add(m[1]!);
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
