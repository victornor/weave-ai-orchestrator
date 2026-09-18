/**
 * What a weaver reply may turn into an attachment (VS-273, openspec design.md — Decisions 2-3, 5-7).
 * A candidate path is resolved with `realpathSync` and checked against an explicit allowlist —
 * the workspace's `knowledge/` tree, its `projects/` tree, and each worker's own `work/` worktree —
 * never "the workspace root minus some exclusions". Every path in a request is validated (allowlist,
 * `.git` exclusion, size cap) before any byte is read, so a rejection never leaves a partial zip or a
 * message missing the attachment that failed.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { OcError, ATTACHMENT_MAX_OUTBOUND_FILE_BYTES, ATTACHMENT_MAX_ZIP_INPUT_BYTES, ATTACHMENT_ZIP_MEDIA_TYPE, guessOutboundMediaType } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import { sanitizeAttachmentFilename } from './attachmentStorage.js';
import { buildZip, zipEntryNamesFor } from './zip.js';

function tryRealpath(p: string): string | null {
  try { return realpathSync(p); } catch { return null; }
}

function isUnderRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/** True for the `.git` directory itself or anything nested under it, at any depth in the path. */
function hasGitSegment(resolved: string): boolean {
  return resolved.split(sep).includes('.git');
}

/**
 * The canonicalized roots a path may resolve inside: the knowledge tree, the projects tree, and every
 * worker's own `work/` worktree (live under `paths.workers`, retired under `paths.archive`) — never
 * the whole worker home, which can hold material never meant to leave the box. Computed fresh per
 * call: a workspace's project/worker set changes at runtime, and this is cheap relative to reading a
 * file.
 */
export function resolveOutboundAttachmentRoots(ctx: WorkspaceContext): string[] {
  const roots: string[] = [];
  const knowledge = tryRealpath(ctx.paths.knowledge);
  if (knowledge) roots.push(knowledge);
  const projects = tryRealpath(ctx.paths.projects);
  if (projects) roots.push(projects);
  for (const base of [ctx.paths.workers, ctx.paths.archive]) {
    let homes: string[];
    try { homes = readdirSync(base); } catch { continue; }
    for (const home of homes) {
      const work = tryRealpath(join(base, home, 'work'));
      if (work) roots.push(work);
    }
  }
  return roots;
}

/**
 * Resolves and validates one candidate path, in the order the plan review asked for: canonicalize,
 * reject a `.git` segment, then check root containment — so a `.git` path is never merely "outside
 * the allowlist" but named as the specific reason. Throws a named `OcError('validation', ...)` on any
 * failure; never returns a path silently narrowed or skipped.
 */
export function assertAttachablePath(ctx: WorkspaceContext, rawPath: string, roots?: string[]): string {
  const resolved = tryRealpath(rawPath);
  if (!resolved) throw new OcError('validation', `"${rawPath}" cannot be attached: it does not exist or cannot be read`);
  if (hasGitSegment(resolved)) {
    throw new OcError('validation', `"${rawPath}" cannot be attached: it is inside a .git directory`);
  }
  // Callers validating several paths in one request (`resolveOutboundAttachments`) pass their own
  // roots, computed once, rather than repeating the workers/archive filesystem walk per path.
  const attachableRoots = roots ?? resolveOutboundAttachmentRoots(ctx);
  if (!attachableRoots.some((root) => isUnderRoot(resolved, root))) {
    throw new OcError('validation', `"${rawPath}" cannot be attached: it is outside the knowledge tree, every project's clone, and every worker's worktree`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new OcError('validation', `"${rawPath}" cannot be attached: it is not a regular file`);
  return resolved;
}

/**
 * VS-555: the extra root a *ticket* attachment may read from — the acting agent's own home, live or
 * archived, and only that agent's. Returns the realpath-resolved directory, or null when the actor is
 * not an agent or has no home on disk. Deliberately separate from `resolveOutboundAttachmentRoots`,
 * which must stay exactly as it is for `weave_human_send`'s chat boundary.
 */
export function actingAgentHome(ctx: WorkspaceContext, actor: { kind: string; id: string | null }): string | null {
  if (actor.kind !== 'agent' || !actor.id) return null;
  for (const base of [ctx.paths.workers, ctx.paths.archive]) {
    const home = tryRealpath(join(base, actor.id));
    if (!home) continue;
    try {
      if (statSync(home).isDirectory()) return home;
    } catch {
      /* not readable as a directory; try the next base */
    }
  }
  return null;
}

/**
 * A worker home is not safe to read wholesale: it holds the runtime's config, and some of that config
 * symlinks into the owner's own config. `assertAttachablePath` compares real paths, so a symlink that
 * resolves out of the home is already refused by containment; this closes what is left. A path that
 * resolves under the home and not under one of the standard roots (whose own rules apply, notably the
 * worktree allowance) is refused when any segment relative to the home is hidden — a dotfile or a
 * dot-directory, which is where every runtime keeps its config. Dotfiles and config trees can never
 * be attached, and a hidden symlink cannot be used to reach one.
 */
export function assertNotHiddenUnderHome(resolved: string, home: string | null, standardRoots: string[]): void {
  if (!home || !isUnderRoot(resolved, home)) return;
  if (standardRoots.some((root) => isUnderRoot(resolved, root))) return;
  const segments = resolved.slice(home.length).split(sep).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) {
    throw new OcError('validation', `"${resolved}" cannot be attached: hidden files and runtime config under an agent home are not attachable`);
  }
}

export interface OutboundFileEntry { path: string }
export interface OutboundZipEntry { paths: string[]; zipName?: string }
export type OutboundAttachmentInput = OutboundFileEntry | OutboundZipEntry;

function isZipEntry(e: OutboundAttachmentInput): e is OutboundZipEntry {
  return 'paths' in e;
}

export interface ResolvedOutboundAttachment { filename: string; mediaType: string; bytes: Buffer }

function defaultZipName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `weaver-attachments-${stamp}.zip`;
}

function sanitizeZipName(name: string): string {
  const sanitized = sanitizeAttachmentFilename(name);
  return sanitized.toLowerCase().endsWith('.zip') ? sanitized : `${sanitized}.zip`;
}

/**
 * Validates every path in every entry — allowlist, `.git`, size — before reading any bytes anywhere,
 * then builds the result: a plain file for a single-path entry, one `store`-method zip for a
 * multi-path entry. A failure on any path aborts the whole call; nothing before it is read either.
 */
export function resolveOutboundAttachments(ctx: WorkspaceContext, entries: OutboundAttachmentInput[]): ResolvedOutboundAttachment[] {
  const roots = resolveOutboundAttachmentRoots(ctx);
  const plan = entries.map((entry) => {
    const rawPaths = isZipEntry(entry) ? entry.paths : [entry.path];
    const resolvedPaths = rawPaths.map((p) => assertAttachablePath(ctx, p, roots));
    return { entry, rawPaths, resolvedPaths };
  });

  for (const { entry, rawPaths, resolvedPaths } of plan) {
    if (isZipEntry(entry)) {
      let total = 0;
      for (const [i, resolved] of resolvedPaths.entries()) {
        const size = statSync(resolved).size;
        if (size > ATTACHMENT_MAX_OUTBOUND_FILE_BYTES) {
          throw new OcError('validation', `"${rawPaths[i]}" is ${size} bytes, exceeds the ${ATTACHMENT_MAX_OUTBOUND_FILE_BYTES} byte per-file cap`);
        }
        total += size;
      }
      if (total > ATTACHMENT_MAX_ZIP_INPUT_BYTES) {
        throw new OcError('validation', `this zip's combined input is ${total} bytes, exceeds the ${ATTACHMENT_MAX_ZIP_INPUT_BYTES} byte cap`);
      }
    } else {
      const size = statSync(resolvedPaths[0]!).size;
      if (size > ATTACHMENT_MAX_OUTBOUND_FILE_BYTES) {
        throw new OcError('validation', `"${rawPaths[0]}" is ${size} bytes, exceeds the ${ATTACHMENT_MAX_OUTBOUND_FILE_BYTES} byte cap`);
      }
    }
  }

  return plan.map(({ entry, rawPaths, resolvedPaths }) => {
    if (isZipEntry(entry)) {
      // Named from the realpath-resolved paths, never the raw ones the caller typed: a resolved path
      // is canonical and has no `..` segment by construction, so a `..`-containing raw path colliding
      // with another entry's base name can never produce a zip-slip entry name like `../x.md` — the
      // whole class is closed by construction rather than pattern-matched (plan-review fix).
      const names = zipEntryNamesFor(resolvedPaths);
      const zipEntries = resolvedPaths.map((resolved) => ({ name: names.get(resolved)!, bytes: readFileSync(resolved) }));
      return { filename: sanitizeZipName(entry.zipName ?? defaultZipName()), mediaType: ATTACHMENT_ZIP_MEDIA_TYPE, bytes: buildZip(zipEntries) };
    }
    const filename = sanitizeAttachmentFilename(basename(rawPaths[0]!));
    return { filename, mediaType: guessOutboundMediaType(filename), bytes: readFileSync(resolvedPaths[0]!) };
  });
}
