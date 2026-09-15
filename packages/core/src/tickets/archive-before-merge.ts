/**
 * VS-327 design.md Decisions 3/5: the mechanics of landing a ticket's OpenSpec change onto its own
 * branch before the merge, instead of onto the landing branch after it. Each function here is a
 * small, independently testable step; `tickets/service.ts`'s `mergeDone` composes them into the
 * full archive-then-merge sequence (design.md Decision 1).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OcError } from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { git } from '../util/git.js';
import * as cli from '../openspec/cli.js';
import { fillArchivedCapabilityPurposes } from '../openspec/purpose.js';
import { scratchLandWorktree, type ScratchTarget } from './scratch.js';

export type { ScratchLand } from './scratch.js';

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
 * Brings a scratch worktree's detached HEAD up to date with `landingRef` (design.md Decision 5).
 * A clean rebase leaves the worktree ready to archive and push; a conflict aborts the rebase (leaving
 * the worktree's HEAD exactly where it started) and reports it — the only case that goes back to
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
 * Runs `openspec archive` in the scratch worktree and commits the result onto the worktree's HEAD
 * (design.md Decision 3) — never onto the landing branch, and never pushed by this function; the
 * caller pushes once every step here has succeeded. Throws `openspec_archive_blocked` (or
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

/**
 * VS-408: rebuild an archive that has already been archived on its branch against the current
 * landing tip. The branch is its pre-archive base plus the archive commit, so the base — where the
 * live change directory still lives — is the merge base with the landing tip. Reset the worktree to
 * the landing tip, restore the change directory from that base when the tip no longer carries it,
 * and re-run `openspec archive` there so the change's deltas merge into the specs as they now stand.
 * Returns exactly what `archiveOnBranch` does, and throws its `OcError` when the CLI refuses.
 */
async function rebuildArchiveFromLandingTip(worktreePath: string, landingRef: string, changeName: string): Promise<ArchiveOnBranchResult> {
  const parent = (await git(['merge-base', 'HEAD', landingRef], worktreePath, 30_000)).stdout.trim();
  const reset = await git(['reset', '--hard', landingRef], worktreePath, 60_000);
  if (!reset.ok) throw new OcError('internal', `git reset to ${landingRef} failed: ${reset.stderr.trim().slice(0, 300)}`, { changeName });
  const changePath = join('openspec', 'changes', changeName);
  if (!existsSync(join(worktreePath, changePath))) {
    if (!parent) throw new OcError('openspec_archive_blocked', `no pre-archive parent found to restore ${changePath} from`, { changeName });
    const restore = await git(['checkout', parent, '--', changePath], worktreePath, 30_000);
    if (!restore.ok || !existsSync(join(worktreePath, changePath))) {
      throw new OcError('openspec_archive_blocked', `could not restore ${changePath} from ${parent}: ${restore.stderr.trim().slice(0, 300)}`, { changeName, parent });
    }
  }
  return archiveOnBranch(worktreePath, changeName);
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
  /**
   * VS-393: whether the project requires CI. When true, an absent check rollup on a head this
   * sequence just pushed, or on a pull request it just brought out of draft, is treated as checks
   * not yet resolved rather than as a pass. A project with `requireCi: false` merges on `none` as
   * before. Defaults to `false` — the pre-VS-393 behaviour — for a caller that does not say.
   */
  requiresCi?: boolean;
  /** VS-393: how long to wait for a rollup before merging as a no-CI project. Defaults to `CI_NONE_GRACE_MS`; a test passes a small value. */
  noCiGraceMs?: number;
  /** VS-393: called once when the grace elapses and this sequence stops waiting and merges anyway, so the ticket records why. */
  onNoCiTimeout?: () => void | Promise<void>;
  /**
   * VS-408: when true, a stale branch whose rebase onto the landing tip conflicts is rebuilt from
   * that tip instead of being reported as `conflict`. Only the archive-backfill landing
   * (`tickets.landArchiveBackfill`) sets this: its branch holds the ticket's archive commit alone, so
   * a reset to the landing tip loses no work, whereas a ticket branch may carry other commits a
   * rebuild would silently drop. Defaults to false — the pre-VS-408 behaviour.
   */
  rebuildArchiveOnConflict?: boolean;
  /** VS-383: where the scratch worktree is created — under the workspace state dir, never `/tmp`. */
  scratch: ScratchTarget;
}

export type ArchiveThenMergeOutcome =
  | { kind: 'merged'; mergeCommit: string | undefined; archivedAs: string | null }
  | { kind: 'conflict'; detail: string }
  | { kind: 'rebuild_failed'; detail: string }
  | { kind: 'checks_pending' }
  | { kind: 'checks_failed' };

/**
 * VS-393: how long a landing waits for a check rollup to appear on the head it just pushed or the
 * pull request it just brought out of draft, when the forge cannot say whether the repository has any
 * CI, before it stops waiting and merges as a no-CI project. Ten minutes: GitHub's queued-run latency
 * is seconds and this repo's slowest job is ~6.5 minutes, so a real run registers far inside it, while
 * a merge that would otherwise never land is not stalled for more than the merge step already costs.
 */
export const CI_NONE_GRACE_MS = 10 * 60_000;

/**
 * When this sequence first saw an absent rollup for a pull request, so the grace above survives the
 * landing's retries. It lives in the daemon process, which holds those retries; a restart restarts the
 * grace, which can only delay a no-CI merge, never break one. Entries are dropped as soon as a rollup
 * appears or a landing concludes.
 */
const noneSinceByPr = new Map<string, number>();

/** A clone's "does this repo have any CI workflows" answer, cached so a landing retry does not re-ask. */
const CI_WORKFLOWS_TTL_MS = 5 * 60_000;
const ciWorkflowsByClone = new Map<string, { at: number; value: boolean | null }>();

/** Test-only: forget the per-pull-request and per-clone no-CI state between cases. */
export function resetNoCiStateForTests(): void { noneSinceByPr.clear(); ciWorkflowsByClone.clear(); }

async function repoHasCiWorkflows(forge: ForgeAdapter, clonePath: string): Promise<boolean | null> {
  if (!forge.hasCiWorkflows) return null;
  const cached = ciWorkflowsByClone.get(clonePath);
  if (cached && Date.now() - cached.at < CI_WORKFLOWS_TTL_MS) return cached.value;
  const value = await forge.hasCiWorkflows(clonePath).catch(() => null);
  ciWorkflowsByClone.set(clonePath, { at: Date.now(), value });
  return value;
}

/**
 * The archive-then-merge sequence (design.md Decision 1/2): fetch the current landing tip, rebase
 * the ticket's branch onto it if it has fallen behind (Decision 5), archive the ticket's OpenSpec
 * change onto that branch if it has one, bring the pull request out of draft, push, and merge — never
 * pushing anything to the landing branch itself (Decision 3). A real rebase conflict or an archive
 * failure stop here; the caller decides how to report either back to the ticket.
 *
 * Required-checks handling (design.md Decision 6): a still-pending check is reported as
 * `checks_pending` rather than awaited across a released lock and a supervisor sweep — that bounded,
 * lock-released wait is tracked as a follow-up, not yet built. VS-466: the sequence requires the
 * resolved checks to be on the exact head it produces (a rolled-up `success` the forge reports for
 * another commit is not a pass), and a repository the forge says has CI workflows never lands on an
 * absent or all-skipped rollup. A repository with no CI workflows (VS-393) merges immediately; when
 * the forge cannot say, the sequence waits for `CI_NONE_GRACE_MS` and then merges anyway, so a
 * landing never retries forever on checks that will not come.
 */
export async function attemptArchiveThenMerge(opts: ArchiveThenMergeOpts): Promise<ArchiveThenMergeOutcome> {
  const { clonePath, branch, landingBranch, changeName, forge, prUrl, method, requiresCi = false, scratch: scratchTarget } = opts;
  await git(['fetch', 'origin', landingBranch], clonePath, 300_000);
  const landingRef = `origin/${landingBranch}`;
  const scratch = await scratchLandWorktree(clonePath, branch, scratchTarget);
  try {
    let changed = false;
    let archivedAs: string | null = null;
    let rebuilt = false;
    const fresh = await isFreshAgainstLanding(scratch.path, 'HEAD', landingRef);
    if (!fresh) {
      const rebased = await rebaseOntoLanding(scratch.path, landingRef);
      if (rebased.ok) {
        changed = true;
      } else if (opts.rebuildArchiveOnConflict && changeName) {
        // VS-408: the rebase can never apply when the archive commit rewrites a spec file main has
        // changed since the branch was cut. Rebuild the archive against the current landing tip
        // instead of retrying a conflict that cannot resolve (see design.md Decisions 1-3).
        try {
          const result = await rebuildArchiveFromLandingTip(scratch.path, landingRef, changeName);
          archivedAs = result.archivedAs;
          rebuilt = true;
          changed = true;
        } catch (e) {
          return { kind: 'rebuild_failed', detail: e instanceof Error ? e.message : String(e) };
        }
      } else {
        return { kind: 'conflict', detail: rebased.detail };
      }
    }
    if (changeName && !rebuilt) {
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
    // VS-466: bring the pull request out of draft *before* the push. A push made while the pull
    // request is still a draft starts only a run whose every job the draft guard skips, which is the
    // all-skipped rollup the gate used to read as a pass on the head that then landed. Out of draft
    // first, the push's own run evaluates that head. A rebase/archive push made while the PR is a
    // draft starts no run, so this transition is what begins one.
    let changedDraft = false;
    if (forge.markPullRequestReady) {
      changedDraft = (await forge.markPullRequestReady(clonePath, prUrl)).changed;
    }
    if (changed) {
      // The scratch worktree is detached (VS-363), so push its HEAD to the remote branch by explicit
      // refspec — never via a local branch, which git would refuse to check out while the worker's
      // worktree holds it. `--force-with-lease` checks against the `origin/<branch>` the fetch above
      // left current, exactly as it did when the scratch worktree was on the branch.
      const push = await git(['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`], scratch.path, 120_000);
      if (!push.ok) throw new OcError('internal', `push of ${branch} failed: ${push.stderr.trim().slice(0, 300)}`, { branch });
    }
    // VS-466: the exact head this landing produces — the scratch worktree's HEAD after any push, and
    // the remote branch tip (fetched above) when nothing needed pushing.
    const expectedHead = (await git(['rev-parse', 'HEAD'], scratch.path, 15_000)).stdout.trim() || null;
    const state = await forge.prState(clonePath, prUrl);
    // A rollup the forge reports for any head other than the one this landing produces is evidence
    // about a different commit, so it can never be a pass for this one: wait and re-read.
    if (expectedHead && state.headSha && state.headSha !== expectedHead) {
      noneSinceByPr.delete(prUrl);
      return { kind: 'checks_pending' };
    }
    if (state.ciState === 'pending') {
      noneSinceByPr.delete(prUrl);
      return { kind: 'checks_pending' };
    }
    if (requiresCi && state.ciState === 'none') {
      // A head this sequence just pushed, or a PR it just brought out of draft, cannot have
      // registered its checks yet: an absent rollup there is "not yet", never a pass — unless the
      // repository has no CI workflows at all, which merges exactly as it did before VS-393. A forge
      // that cannot answer waits, but only for the bounded grace, so a repo we cannot classify still
      // lands instead of retrying forever on checks that will never exist.
      const hasWorkflows = await repoHasCiWorkflows(forge, clonePath);
      if (hasWorkflows === true) {
        // VS-466: a repository with CI workflows never lands on an absent (or all-skipped) rollup.
        // Wait for the run the transition above started; retry, never land, until it resolves.
        noneSinceByPr.delete(prUrl);
        return { kind: 'checks_pending' };
      }
      if (hasWorkflows === null) {
        const waiting = changed || changedDraft || noneSinceByPr.has(prUrl);
        if (waiting) {
          const since = noneSinceByPr.get(prUrl) ?? Date.now();
          noneSinceByPr.set(prUrl, since);
          if (Date.now() - since < (opts.noCiGraceMs ?? CI_NONE_GRACE_MS)) return { kind: 'checks_pending' };
          // Past the grace: stop waiting and merge as a no-CI project, with the caller's one report.
          noneSinceByPr.delete(prUrl);
          await opts.onNoCiTimeout?.();
        } else {
          noneSinceByPr.delete(prUrl);
        }
      } else {
        noneSinceByPr.delete(prUrl);
      }
    } else if (state.ciState !== 'none') {
      noneSinceByPr.delete(prUrl);
    }
    if (state.ciState === 'failure') return { kind: 'checks_failed' };
    const result = await forge.mergePr(clonePath, prUrl, method);
    return { kind: 'merged', mergeCommit: result.mergeCommit, archivedAs };
  } finally {
    await scratch.dispose();
  }
}
