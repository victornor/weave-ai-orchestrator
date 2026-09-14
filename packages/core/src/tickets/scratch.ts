/**
 * VS-383: throwaway worktrees created while landing a ticket's branch (`archive-before-merge.ts`)
 * and while writing a project's out-of-ticket knowledge (`knowledge/repoDelivery.ts`). They live
 * under the workspace state directory — never on a RAM-backed tmpfs — are named per project and
 * caller, and are always removed; a failure or a crash that leaves one behind is reclaimed by the
 * sweep (`sweepScratchWorktrees`), which the supervisor runs at boot and on a period.
 *
 * The old code created the directory with `mkdtempSync(tmpdir())` and registered the worktree
 * *before* returning its `dispose` handle, so any throw in between (pre-VS-363, the ordinary
 * `git checkout -B <branch>` refusal while the worker's own worktree held the branch) leaked both
 * the directory and its registration with no handle for the caller's `finally` to clean (VS-383).
 * Creation here creates the root first and removes what it made if anything after that fails.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, type Dirent } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { OcError } from '@weave-ai/shared';
import { git } from '../util/git.js';
import { getLogger } from '../logger.js';

const log = getLogger('ticket', { component: 'scratch' });

/** The `mkdtemp` prefix scratch trees used on `/tmp` before VS-383; still swept where they belong to a known clone. */
export const LEGACY_SCRATCH_PREFIX = 'ac-land-';
/** Scratch trees older than this and not in flight are stale. Every landing step's own timeout is far below it. */
export const SCRATCH_STALE_MS = 30 * 60_000;

/** The scratch worktrees this process currently has open. A sweep must never remove one of these. */
const activeScratchPaths = new Set<string>();
export function activeScratchWorktrees(): ReadonlySet<string> { return activeScratchPaths; }

/** Where a scratch worktree goes: the workspace state dir, the project, and the caller's identity. */
export interface ScratchTarget {
  /** `WorkspacePaths.state`; scratch lives in `<stateDir>/scratch/` — never `/tmp`. */
  stateDir: string;
  /** The project's slug, so a tree is identifiable per project. */
  projectSlug: string;
  /** The caller within the project, e.g. a ticket identifier or `knowledge-<slug>`. */
  label: string;
}

export interface ScratchLand {
  /** The scratch worktree's path. */
  path: string;
  /** Removes the scratch worktree (and its scratch branch, if it made one). Safe to call more than once. */
  dispose(): Promise<void>;
}

export function scratchRoot(stateDir: string): string { return join(stateDir, 'scratch'); }

/** A path component that cannot escape its parent or confuse the naming (a slash, a `..`, a space). */
function safeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'scratch';
}

function scratchParent(target: ScratchTarget): string {
  return join(scratchRoot(target.stateDir), safeSegment(target.projectSlug));
}

/**
 * Is `path` one of ours? Either a scratch tree under this workspace's state dir, or a legacy
 * `/tmp/ac-land-*` directory. A worker's own worktree (under `workers/`) is never matched.
 */
export function isScratchPath(path: string, stateDir: string): boolean {
  const root = resolve(scratchRoot(stateDir));
  const p = resolve(path);
  if (p === root || p.startsWith(root + sep)) return true;
  return dirname(p) === resolve(tmpdir()) && basename(p).startsWith(LEGACY_SCRATCH_PREFIX);
}

/**
 * Remove a scratch worktree: `git worktree remove --force`, the directory (when git refused — a
 * locked, dirty or submodule-bearing tree), `git worktree prune` to drop the administrative entry,
 * and the scratch branch when one was made. Never throws: a cleanup that fails is logged and the
 * caller (a `dispose`, a sweep) continues — a landing must report its own outcome, not cleanup's.
 */
async function removeScratch(repoPath: string, dir: string, removeBranch?: string): Promise<void> {
  if (repoPath) {
    const removed = await git(['worktree', 'remove', '--force', dir], repoPath, 60_000);
    if (!removed.ok) log.warn({ dir, err: (removed.stderr || removed.stdout).trim().slice(0, 300) }, 'git worktree remove failed; deleting the directory directly');
  }
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
    catch (e) { log.warn({ dir, err: String(e) }, 'scratch worktree directory removal failed'); }
  }
  if (repoPath) {
    await git(['worktree', 'prune'], repoPath, 30_000);
    if (removeBranch) await git(['branch', '-D', removeBranch], repoPath, 30_000);
  }
}

/**
 * Creates the scratch directory and registers the worktree in it. The directory is created first;
 * if `git worktree add` fails it is removed before the error is rethrown, so this function either
 * returns a handle whose `dispose` can clean up or leaves nothing behind.
 */
async function createScratch(
  repoPath: string,
  target: ScratchTarget,
  addArgs: (dir: string) => string[],
  removeBranch?: string,
): Promise<ScratchLand> {
  mkdirSync(scratchParent(target), { recursive: true });
  const dir = mkdtempSync(join(scratchParent(target), `${safeSegment(target.label)}-`));
  const add = await git(['worktree', 'add', ...addArgs(dir)], repoPath, 120_000);
  if (!add.ok) {
    await removeScratch(repoPath, dir, removeBranch);
    throw new OcError('internal', `git worktree add failed: ${(add.stderr || add.stdout).trim().slice(0, 300)}`, { dir });
  }
  activeScratchPaths.add(dir);
  let disposed = false;
  return {
    path: dir,
    async dispose() {
      if (disposed) return;
      disposed = true;
      activeScratchPaths.delete(dir);
      await removeScratch(repoPath, dir, removeBranch);
    },
  };
}

/**
 * Creates a throwaway detached worktree of the project's primary clone at `origin/<branch>`
 * (design.md Decision 3), so archiving and rebasing a ticket's branch never disturbs the primary
 * clone's own checkout on the landing branch — and never requires a local checkout of `<branch>`,
 * which git refuses while the requesting worker's worktree holds it (VS-363). The primary clone's
 * object store is reused — no re-clone — only its working tree is not touched. VS-383: the tree is
 * created under `target`'s state dir, never `/tmp`.
 */
export async function scratchLandWorktree(repoPath: string, branch: string, target: ScratchTarget): Promise<ScratchLand> {
  const fetch = await git(['fetch', 'origin', branch], repoPath, 300_000);
  if (!fetch.ok) throw new OcError('internal', `fetch of ${branch} failed: ${fetch.stderr.trim().slice(0, 300)}`, { branch });
  return createScratch(repoPath, target, (dir) => ['--detach', dir, `origin/${branch}`]);
}

/**
 * Creates a brand-new local branch from `baseRef`, checked out in a throwaway worktree of the
 * project's primary clone — used by OpenSpec archive backfill (VS-327 task 4) and out-of-ticket
 * knowledge delivery (VS-358) to carry a change on its own branch, so it can be opened as a pull
 * request rather than pushed straight to the landing branch. VS-383: under `target`'s state dir.
 */
export async function scratchBranchFrom(repoPath: string, baseRef: string, newBranch: string, target: ScratchTarget): Promise<ScratchLand> {
  return createScratch(repoPath, target, (dir) => ['-b', newBranch, dir, baseRef], newBranch);
}

export interface ScratchTreeInfo {
  path: string;
  /** The clone the tree belongs to; empty when the tree is ours but no known clone owns it (removed by direct delete). */
  clonePath: string;
  bytes: number;
  mtimeMs: number;
  /** A `ac-land-*` tree from the pre-VS-383 `/tmp` layout. */
  legacy: boolean;
  /** The local branch the worktree holds, when it holds one (a `scratchBranchFrom` tree). */
  branch?: string;
}

/** A known project clone; `slug` lets a new-layout scratch subdirectory be attributed to it. */
export interface ScratchClone { clonePath: string; slug?: string }

function directorySize(path: string): number {
  let total = 0;
  let entries: Dirent[];
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow a link out of the tree
    if (entry.isDirectory()) total += directorySize(child);
    else if (entry.isFile()) { try { total += statSync(child).size; } catch { /* vanished mid-walk */ } }
  }
  return total;
}

function describe(path: string, clonePath: string, branch?: string): ScratchTreeInfo | null {
  let st: ReturnType<typeof statSync>;
  try { st = statSync(path); } catch { return null; }
  return { path, clonePath, bytes: directorySize(path), mtimeMs: st.mtimeMs, legacy: basename(path).startsWith(LEGACY_SCRATCH_PREFIX), branch };
}

/** Registered worktrees of one clone, with the branch each holds when it holds one. */
async function registeredWorktrees(clonePath: string): Promise<Array<{ path: string; branch?: string }>> {
  const listed = await git(['worktree', 'list', '--porcelain'], clonePath, 30_000);
  if (!listed.ok) return [];
  const out: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | null = null;
  for (const line of listed.stdout.split('\n')) {
    if (line.startsWith('worktree ')) { if (current) out.push(current); current = { path: line.slice('worktree '.length).trim() }; }
    else if (line.startsWith('branch ') && current) current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
  }
  if (current) out.push(current);
  return out;
}

/** The clone a legacy `/tmp/ac-land-*` directory belongs to, read from its `.git` file's gitdir. */
function legacyOwner(path: string, clones: ScratchClone[]): string {
  let gitdir: string;
  try { gitdir = readFileSync(join(path, '.git'), 'utf8'); } catch { return ''; }
  const marker = 'gitdir: ';
  if (!gitdir.startsWith(marker)) return '';
  const target = resolve(gitdir.slice(marker.length).trim());
  for (const clone of clones) {
    if (target.startsWith(resolve(clone.clonePath, '.git', 'worktrees') + sep)) return clone.clonePath;
  }
  return '';
}

function scratchRootEntries(stateDir: string, clones: ScratchClone[]): Array<{ path: string; clonePath: string }> {
  const root = scratchRoot(stateDir);
  const bySlug = new Map(clones.filter((c) => c.slug).map((c) => [safeSegment(c.slug as string), c.clonePath]));
  const out: Array<{ path: string; clonePath: string }> = [];
  let projects: Dirent[];
  try { projects = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let trees: Dirent[];
    try { trees = readdirSync(join(root, project.name), { withFileTypes: true }); } catch { continue; }
    for (const tree of trees) {
      if (!tree.isDirectory()) continue;
      out.push({ path: join(root, project.name, tree.name), clonePath: bySlug.get(project.name) ?? '' });
    }
  }
  return out;
}

function legacyScratchEntries(clones: ScratchClone[]): Array<{ path: string; clonePath: string }> {
  const out: Array<{ path: string; clonePath: string }> = [];
  let entries: Dirent[];
  try { entries = readdirSync(tmpdir(), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(LEGACY_SCRATCH_PREFIX)) continue;
    const path = join(tmpdir(), entry.name);
    const clonePath = legacyOwner(path, clones);
    if (clonePath) out.push({ path, clonePath });
  }
  return out;
}

/**
 * Every scratch tree of these clones: their registered scratch worktrees, any leftover directory
 * directly under the scratch root, and any legacy `/tmp/ac-land-*` directory that belongs to one of
 * them. Read-only; the inspector behind `GET /api/daemon/scratch` and the sweep's input.
 */
export async function listScratchTrees(clones: ScratchClone[], stateDir: string): Promise<ScratchTreeInfo[]> {
  if (!stateDir) return [];
  const found = new Map<string, ScratchTreeInfo>();
  for (const clone of clones) {
    for (const wt of await registeredWorktrees(clone.clonePath)) {
      if (resolve(wt.path) === resolve(clone.clonePath) || !isScratchPath(wt.path, stateDir)) continue;
      const info = describe(wt.path, clone.clonePath, wt.branch);
      if (info) found.set(info.path, info);
    }
  }
  for (const { path, clonePath } of [...scratchRootEntries(stateDir, clones), ...legacyScratchEntries(clones)]) {
    if (found.has(path)) continue;
    const info = describe(path, clonePath);
    if (info) found.set(info.path, info);
  }
  return [...found.values()];
}

export interface ScratchSweepResult { removed: ScratchTreeInfo[]; bytes: number }

/**
 * Removes scratch trees older than `minAgeMs` that no landing in this process is using. Called at
 * daemon boot and on a supervisor period. Never throws for one tree: a failed removal is logged and
 * the sweep continues, and a later sweep tries again.
 */
export async function sweepScratchWorktrees(opts: {
  clones: ScratchClone[];
  stateDir: string;
  minAgeMs?: number;
  active?: ReadonlySet<string>;
  now?: number;
}): Promise<ScratchSweepResult> {
  const minAge = opts.minAgeMs ?? SCRATCH_STALE_MS;
  const now = opts.now ?? Date.now();
  const active = opts.active ?? activeScratchPaths;
  const removed: ScratchTreeInfo[] = [];
  for (const info of await listScratchTrees(opts.clones, opts.stateDir)) {
    if (active.has(info.path)) continue;
    // Clamp a future mtime (filesystem and Date clocks are not exactly aligned) to zero, so a
    // just-created tree is `age 0` rather than negative; with the default threshold it is still
    // well below the stale age and is left alone.
    const age = Math.max(0, now - info.mtimeMs);
    if (age < minAge) continue;
    await removeScratch(info.clonePath, info.path, info.branch);
    removed.push(info);
  }
  return { removed, bytes: removed.reduce((n, r) => n + r.bytes, 0) };
}
