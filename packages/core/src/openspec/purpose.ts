/**
 * VS-362: when `openspec archive` builds the main spec for a capability a change creates, it writes
 * a placeholder Purpose unless the change's delta carried its own `## Purpose`. Nothing the daemon
 * ran afterwards replaced it, so specs accumulated the placeholder and `openspec validate --all
 * --strict` failed repo-wide. This leaf helper detects that placeholder, fills it from the archived
 * change's proposal "Why" when the daemon archives a change, and backs the repository guard that
 * keeps the placeholder from returning.
 *
 * The two fixed halves of the placeholder sentence are read from OpenSpec's own definition
 * (`PURPOSE_PLACEHOLDER_PREFIX`/`SUFFIX`), so a wording change in the CLI is one edit here rather
 * than a second, hand-copied spelling that silently stops matching.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OcError } from '@weave-ai/shared';
import { archivedDirFor } from './cli.js';

export const PURPOSE_PLACEHOLDER_PREFIX = 'TBD - created by archiving change ';
export const PURPOSE_PLACEHOLDER_SUFFIX = '. Update Purpose after archive.';

/** The one line `openspec archive` writes for a new capability whose delta had no `## Purpose`. */
const PLACEHOLDER_LINE = new RegExp(
  `^${PURPOSE_PLACEHOLDER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?${PURPOSE_PLACEHOLDER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
  'm',
);

/** Is this spec body's Purpose still the placeholder `openspec archive` writes? */
export function containsPlaceholderPurpose(text: string): boolean {
  const prefixAt = text.indexOf(PURPOSE_PLACEHOLDER_PREFIX);
  if (prefixAt === -1) return false;
  return text.indexOf(PURPOSE_PLACEHOLDER_SUFFIX, prefixAt + PURPOSE_PLACEHOLDER_PREFIX.length) !== -1;
}

/** The change name embedded between the placeholder's two halves, or null when the text is not one. */
export function placeholderChangeName(text: string): string | null {
  const prefixAt = text.indexOf(PURPOSE_PLACEHOLDER_PREFIX);
  if (prefixAt === -1) return null;
  const nameStart = prefixAt + PURPOSE_PLACEHOLDER_PREFIX.length;
  const suffixAt = text.indexOf(PURPOSE_PLACEHOLDER_SUFFIX, nameStart);
  if (suffixAt === -1) return null;
  return text.slice(nameStart, suffixAt).trim() || null;
}

function specFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name === 'spec.md') out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Every `spec.md` under a `openspec/specs` tree whose Purpose still contains the placeholder. */
export function findPlaceholderPurposeSpecs(specsRoot: string): string[] {
  return specFilesUnder(specsRoot).filter((f) => containsPlaceholderPurpose(readFileSync(f, 'utf8')));
}

/**
 * The first non-empty paragraph of a proposal's `## Why` section, or null when the section is
 * absent or empty. The paragraph is returned trimmed and verbatim — the archive step writes it into
 * the new spec's Purpose as-is.
 */
export function extractWhyParagraph(proposalText: string): string | null {
  const lines = proposalText.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##[ \t]+Why[ \t]*$/i.test(line));
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##[ \t]+/.test(lines[i]!)) break;
    body.push(lines[i]!);
  }
  const paragraph = body.join('\n').trim().split(/\n[ \t]*\n/)[0]?.trim() ?? '';
  return paragraph.length ? paragraph : null;
}

/** Replaces the placeholder line in a spec body, preserving every other byte. */
function replacePlaceholderWithPurpose(specText: string, purpose: string): string {
  return specText.replace(PLACEHOLDER_LINE, purpose);
}

export interface FillArchivedPurposesResult {
  /** Spec files (path relative to `clonePath`) whose placeholder Purpose was replaced. */
  filled: string[];
}

/**
 * After a change has been archived in `clonePath`, gives every capability spec the archive created
 * whose Purpose is still the placeholder a real Purpose drawn from that change's archived proposal
 * "Why". Throws `openspec_archive_blocked` — the same code (and so the same archive-failure path)
 * the CLI wrapper uses — when a placeholder exists and the proposal has no usable "Why", so a
 * placeholder is never committed or pushed.
 *
 * A change that created no capability (only modified existing ones) leaves nothing to fill, and
 * this returns an empty result.
 */
export function fillArchivedCapabilityPurposes(clonePath: string, changeName: string): FillArchivedPurposesResult {
  const specsRoot = join(clonePath, 'openspec', 'specs');
  const ours = findPlaceholderPurposeSpecs(specsRoot).filter((f) => {
    const embedded = placeholderChangeName(readFileSync(f, 'utf8'));
    return embedded !== null && (embedded === changeName || changeName.startsWith(embedded));
  });
  if (ours.length === 0) return { filled: [] };

  const archived = archivedDirFor(clonePath, changeName);
  const proposalPath = archived ? join(clonePath, 'openspec', 'changes', 'archive', archived, 'proposal.md') : null;
  const why = proposalPath && existsSync(proposalPath) ? extractWhyParagraph(readFileSync(proposalPath, 'utf8')) : null;
  const names = ours.map((f) => relative(clonePath, f).split(sep).join('/'));

  if (!why) {
    throw new OcError(
      'openspec_archive_blocked',
      `archiving ${changeName} created a capability whose Purpose is still the archive placeholder, and the change's proposal has no usable "Why" to fill it from: ${names.join(', ')}. Add a "Why" to the proposal, or a "## Purpose" to the capability's spec delta, then retry.`,
      { changeName, specs: names },
    );
  }

  for (const f of ours) writeFileSync(f, replacePlaceholderWithPurpose(readFileSync(f, 'utf8'), why));
  return { filled: names };
}
