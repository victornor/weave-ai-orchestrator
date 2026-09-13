/**
 * VS-327 design.md Decisions 3/5: the mechanics of landing a ticket's OpenSpec change onto its own
 * branch before the merge, instead of onto the landing branch after it. Each function here is a
 * small, independently testable step; `tickets/service.ts`'s `mergeDone` composes them into the
 * full archive-then-merge sequence (design.md Decision 1).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OcError } from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { git } from '../util/git.js';
import * as cli from '../openspec/cli.js';
import { fillArchivedCapabilityPurposes } from '../openspec/purpose.js';

export interface ScratchLand {
  /** The scratch worktree's path — a checkout of the ticket's branch, outside the primary clone. */
  path: string;
  /** Removes the scratch worktree and its branch. Safe to call once; idempotent on later calls. */
  dispose(): Promise<void>;
}

/**
 * Checks out a ticket's own branch into a throwaway worktree of the project's primary clone
 * (design.md Decision 3), so archiving and rebasing it never disturbs the primary clone's own
 * checkout on the landing branch. The primary clone's object store is reused — no re-clone — only
 * its working tree is not touched.
 */
export async function scratchLandWorktree(repoPath: string, branch: string): Promise<ScratchLand> {
  const dir = mkdtempSync(join(tmpdir(), 'ac-land-'));
  const fetch = await git(['fetch', 'origin', branch], repoPath, 300_000);
  if (!fetch.ok) throw new OcError('internal', `fetch of ${branch} failed: ${fetch.stderr.trim().slice(0, 300)}`, { branch });
  const add = await git(['worktree', 'add', '--detach', dir, `origin/${branch}`], repoPath, 120_000);
  if (!add.ok) throw new OcError('internal', `git worktree add for ${branch} failed: ${add.stderr.trim().slice(0, 300)}`, { branch, dir });
  const checkout = await git(['checkout', '-B', branch], dir, 30_000);
  if (!checkout.ok) throw new OcError('internal', `checkout of ${branch} in the scratch worktree failed: ${checkout.stderr.trim().slice(0, 300)}`, { branch });
  let disposed = false;
  return {
    path: dir,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await git(['worktree', 'remove', '--force', dir], repoPath, 60_000).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      await git(['worktree', 'prune'], repoPath, 30_000).catch(() => {});
    },
  };
}

/**
 * Creates a brand-new local branch from `baseRef`, checked out in a throwaway worktree of the
 * project's primary clone — used by OpenSpec archive backfill (VS-327 task 4) to carry a
 * left-behind change's archive on its own branch, so it can be opened as a pull request rather than
 * pushed straight to the landing branch.
 */
export async function scratchBranchFrom(repoPath: string, baseRef: string, newBranch: string): Promise<ScratchLand> {
  const dir = mkdtempSync(join(tmpdir(), 'ac-land-'));
  const add = await git(['worktree', 'add', '-b', newBranch, dir, baseRef], repoPath, 120_000);
  if (!add.ok) throw new OcError('internal', `git worktree add for ${newBranch} from ${baseRef} failed: ${add.stderr.trim().slice(0, 300)}`, { baseRef, newBranch, dir });
  let disposed = false;
  return {
    path: dir,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await git(['worktree', 'remove', '--force', dir], repoPath, 60_000).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      await git(['worktree', 'prune'], repoPath, 30_000).catch(() => {});
      await git(['branch', '-D', newBranch], repoPath, 30_000).catch(() => {});
    },
  };
}

/**
 * Is `landingRef`'s tip already reachable from `branchRef`? True means the branch is a fast-forward
 * descendant of the current landing tip — nothing to rebase (design.md Decision 5 / archive-before-
 * merge spec's freshness-check requirement). `cwd` only needs `landingRef` and `branchRef` resolvable
 * (a fetched primary clone, or the scratch worktree itself).
 */
export async function isFreshAgainstLanding(cwd: string, branchRef: string, landingRef: string): Promise<boolean> {
  const r = await git(['merge-base', '--is-ancestor', landingRef, branchRef], cwd);
  return r.ok;
}

export type RebaseOutcome = { ok: true } | { ok: false; conflict: true; detail: string };

/**
 * Brings a scratch worktree's checked-out branch up to date with `landingRef` (design.md Decision 5).
 * A clean rebase leaves the worktree ready to archive and push; a conflict aborts the rebase (leaving
 * the worktree's branch exactly where it started) and reports it — the only case that goes back to
 * the worker.
 */
export async function rebaseOntoLanding(worktreePath: string, landingRef: string): Promise<RebaseOutcome> {
  const rebase = await git(['rebase', landingRef], worktreePath, 300_000);
  if (rebase.ok) return { ok: true };
  await git(['rebase', '--abort'], worktreePath, 60_000).catch(() => {});
  return { ok: false, conflict: true, detail: (rebase.stderr || rebase.stdout).trim().slice(0, 2000) };
}

export interface ArchiveOnBranchResult { archivedAs: string | null; specsUpdated: string[]; warnings: string[] }

/**
 * Runs `openspec archive` in the scratch worktree and commits the result onto the checked-out
 * branch (design.md Decision 3) — never onto the landing branch, and never pushed by this function;
 * the caller pushes once every step here has succeeded. Throws `openspec_archive_blocked` (or
 * `internal`) exactly as `openspec/cli.ts`'s `archive` does when the CLI refuses (VS-298's
 * error-code/detail preservation) — the caller treats that as an archive failure that blocks the
 * merge (archive-before-merge spec's archive-failure requirement).
 */
export async function archiveOnBranch(worktreePath: string, changeName: string): Promise<ArchiveOnBranchResult> {
  const result = await cli.archive({ cwd: worktreePath, root: worktreePath }, changeName);
  // VS-362: a capability this archive just created can carry openspec's placeholder Purpose. Fill it
  // from the archived proposal's "Why" before the commit; a missing "Why" throws
  // `openspec_archive_blocked`, which the caller already treats as an archive failure that blocks
  // the merge (rather than letting a placeholder reach the landing branch).
  fillArchivedCapabilityPurposes(worktreePath, changeName);
  const add = await git(['add', '-A', 'openspec'], worktreePath, 30_000);
  if (!add.ok) throw new OcError('internal', `git add of the archive failed: ${add.stderr.trim().slice(0, 300)}`, { changeName });
  const commit = await git(['commit', '-m', `chore(openspec): archive ${changeName}`], worktreePath, 30_000);
  if (!commit.ok) {
    const out = `${commit.stdout} ${commit.stderr}`;
    if (!/nothing to commit|no changes added/i.test(out)) {
      throw new OcError('internal', `git commit of the archive failed: ${commit.stderr.trim().slice(0, 300)}`, { changeName });
    }
  }
  return result;
}

export interface ArchiveThenMergeOpts {
  /** The project's primary clone. Its own checkout (the landing branch) is never touched. */
  clonePath: string;
  /** The ticket's own branch name, as pushed by the worker. */
  branch: string;
  /** The landing branch's plain name (e.g. `main`), not a ref. */
  landingBranch: string;
  /** Null for a ticket that carries no OpenSpec change — archiving is skipped, but staleness and the merge are still handled. */
  changeName: string | null;
  forge: ForgeAdapter;
  prUrl: string;
  method: string;
}

export type ArchiveThenMergeOutcome =
  | { kind: 'merged'; mergeCommit: string | undefined; archivedAs: string | null }
  | { kind: 'conflict'; detail: string }
  | { kind: 'checks_pending' }
  | { kind: 'checks_failed' };

/**
 * The archive-then-merge sequence (design.md Decision 1/2): fetch the current landing tip, rebase
 * the ticket's branch onto it if it has fallen behind (Decision 5), archive the ticket's OpenSpec
 * change onto that branch if it has one, push, and merge — never pushing anything to the landing
 * branch itself (Decision 3). A real rebase conflict or an archive failure stop here; the caller
 * decides how to report either back to the ticket.
 *
 * Required-checks handling (design.md Decision 6) is partial in this version: a still-pending check
 * is reported as `checks_pending` rather than awaited across a released lock and a supervisor sweep
 * — that bounded, lock-released wait is tracked as a follow-up, not yet built. A repository with no
 * required checks (`ciState` `none`, or already `success`) merges immediately, which covers the
 * common case this project itself is in (no CI).
 */
export async function attemptArchiveThenMerge(opts: ArchiveThenMergeOpts): Promise<ArchiveThenMergeOutcome> {
  const { clonePath, branch, landingBranch, changeName, forge, prUrl, method } = opts;
  await git(['fetch', 'origin', landingBranch], clonePath, 300_000);
  const landingRef = `origin/${landingBranch}`;
  const scratch = await scratchLandWorktree(clonePath, branch);
  try {
    let changed = false;
    let archivedAs: string | null = null;
    const fresh = await isFreshAgainstLanding(scratch.path, 'HEAD', landingRef);
    if (!fresh) {
      const rebased = await rebaseOntoLanding(scratch.path, landingRef);
      if (!rebased.ok) return { kind: 'conflict', detail: rebased.detail };
      changed = true;
    }
    if (changeName) {
      // A retry after a `checks_pending` rejection re-fetches the branch this same function already
      // archived and pushed — re-running `openspec archive` on a change folder that is already gone
      // would just throw. Skip re-archiving only when the folder is gone *because this already
      // archived it* (findable under `changes/archive/`) — not merely because it never existed,
      // which is a real error `archiveOnBranch` still needs to report (VS-327 review, PR #272).
      const stillUnarchived = existsSync(join(scratch.path, 'openspec', 'changes', changeName));
      const archivedElsewhere = !stillUnarchived ? cli.archivedDirFor(scratch.path, changeName) : null;
      if (stillUnarchived || !archivedElsewhere) {
        const result = await archiveOnBranch(scratch.path, changeName);
        archivedAs = result.archivedAs;
        changed = true;
      } else {
        archivedAs = archivedElsewhere;
      }
    }
    if (changed) {
      const push = await git(['push', '--force-with-lease', 'origin', `HEAD:${branch}`], scratch.path, 120_000);
      if (!push.ok) throw new OcError('internal', `push of ${branch} failed: ${push.stderr.trim().slice(0, 300)}`, { branch });
    }
    const state = await forge.prState(clonePath, prUrl);
    if (state.ciState === 'pending') return { kind: 'checks_pending' };
    if (state.ciState === 'failure') return { kind: 'checks_failed' };
    const result = await forge.mergePr(clonePath, prUrl, method);
    return { kind: 'merged', mergeCommit: result.mergeCommit, archivedAs };
  } finally {
    await scratch.dispose();
  }
}
