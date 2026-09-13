import { existsSync } from 'node:fs';
import { git, resolveBaseRef } from '../util/git.js';

export interface LandedInput {
  repoPath: string;
  worktreePath: string;
  branch: string;
  /** The ticket's effective landing branch — its own declaration, else its project's, else the project's default branch (VS-119, `landingBranchOf`). */
  landingBranch: string;
  /** The ticket has a merged pull-request work product. */
  mergedPr?: boolean;
  /** deliveryMode = local-branch: the local landing branch is the authority. */
  localBranch?: boolean;
}
export interface LandedVerdict {
  landed: boolean;
  reason: string;
  evidence: Record<string, unknown>;
  /** Relative paths of the untracked files present when the verdict was reached (VS-333). */
  untrackedFiles?: string[];
}

/**
 * Parse `git status --porcelain -z --untracked-files=all` into `{ xy, path }` entries. The NUL
 * separator and `-uall` give one field per file with an exact relative path, so a name containing a
 * space is never split and a directory is not collapsed. Fields that are not `XY <path>` (a rename's
 * second, source-path field) are ignored: they are always part of a tracked change.
 */
function parsePorcelainZ(out: string): Array<{ xy: string; path: string }> {
  const entries: Array<{ xy: string; path: string }> = [];
  for (const field of out.split('\0')) {
    if (field.length < 4 || field[2] !== ' ') continue;
    entries.push({ xy: field.slice(0, 2), path: field.slice(3) });
  }
  return entries;
}

export interface WorktreeChanges { untracked: string[]; tracked: string[]; ok: boolean; error?: string }

/**
 * Classify a worktree's working-tree changes (VS-333). Untracked (`??`) files are leftovers a
 * retirement may archive; anything else is a modified or staged tracked file that must keep blocking.
 * Both `landedWorkTest` and the pre-removal guard in `retireIfLanded` read this one shape.
 */
export async function worktreeChanges(worktreePath: string): Promise<WorktreeChanges> {
  const status = await git(['status', '--porcelain', '-z', '--untracked-files=all'], worktreePath, 30_000);
  if (!status.ok) return { untracked: [], tracked: [], ok: false, error: status.stderr.trim().slice(0, 300) };
  const entries = parsePorcelainZ(status.stdout);
  return {
    untracked: entries.filter((e) => e.xy === '??').map((e) => e.path),
    tracked: entries.filter((e) => e.xy !== '??').map((e) => e.path),
    ok: true,
  };
}

/**
 * PLAN §11.5 landed-work test. A worktree is removed only when the work has provably landed:
 * every commit on the ticket branch is reachable from a remote-tracking branch, OR the PR is merged and the
 * landing branch contains the branch's content (ancestor or patch-id match, i.e. squash merge).
 *
 * Untracked files alone are not "uncommitted work" in this sense (VS-333): a worker's review
 * screenshots and scratch directories are byproducts, not the delivery, so once the committed work has
 * landed the worktree counts as landed and the caller archives those files before removing it.
 * Modified or staged tracked files still count as uncommitted work and block. When we cannot tell,
 * the verdict is "not landed" and nothing is discarded.
 */
export async function landedWorkTest(input: LandedInput): Promise<LandedVerdict> {
  const { repoPath, worktreePath, branch, landingBranch } = input;
  const evidence: Record<string, unknown> = { branch, checkedAt: new Date().toISOString() };

  if (!existsSync(worktreePath)) return { landed: true, reason: 'worktree already absent', evidence: { ...evidence, worktree: 'absent' } };

  const changes = await worktreeChanges(worktreePath);
  if (!changes.ok) return { landed: false, reason: 'cannot read worktree status', evidence: { ...evidence, error: changes.error } };
  const untrackedFiles = changes.untracked;
  evidence.untracked = untrackedFiles.length;
  if (changes.tracked.length) return { landed: false, reason: `${changes.tracked.length} uncommitted change(s) in the worktree`, evidence: { ...evidence, uncommitted: changes.tracked.length }, untrackedFiles };

  const branchOk = await git(['rev-parse', '--verify', '--quiet', branch], repoPath, 15_000);
  if (!branchOk.ok || !branchOk.stdout.trim()) return { landed: false, reason: `branch ${branch} not found in ${repoPath}`, evidence, untrackedFiles };
  evidence.head = branchOk.stdout.trim();

  const withLeftovers = (reason: string): LandedVerdict => ({
    landed: true,
    reason: untrackedFiles.length ? `${reason}; ${untrackedFiles.length} untracked file(s) will be archived` : reason,
    evidence,
    untrackedFiles,
  });

  const remotes = await git(['remote'], repoPath, 15_000);
  const hasRemotes = remotes.ok && remotes.stdout.trim().length > 0;
  if (hasRemotes) {
    const unreached = await git(['rev-list', branch, '--not', '--remotes'], repoPath, 60_000);
    if (unreached.ok) {
      const commits = unreached.stdout.split('\n').filter((l) => l.trim().length > 0);
      evidence.commitsNotOnAnyRemote = commits.length;
      if (commits.length === 0) return withLeftovers('every commit on the branch is reachable from a remote-tracking branch');
    }
  }

  if (input.mergedPr || input.localBranch) {
    const baseRef = input.localBranch ? landingBranch : ((await resolveBaseRef(repoPath, landingBranch)) ?? landingBranch);
    evidence.baseRef = baseRef;
    const ancestor = await git(['merge-base', '--is-ancestor', branch, baseRef], repoPath, 30_000);
    if (ancestor.ok) return withLeftovers(`branch is an ancestor of ${baseRef}`);
    const cherry = await git(['cherry', baseRef, branch], repoPath, 60_000);
    if (cherry.ok) {
      const missing = cherry.stdout.split('\n').filter((l) => l.trim().startsWith('+'));
      evidence.commitsNotInBase = missing.length;
      if (missing.length === 0) return withLeftovers(`every commit has an equivalent patch in ${baseRef} (squash/rebase merge)`);
      return { landed: false, reason: `${missing.length} commit(s) are not contained in ${baseRef}`, evidence, untrackedFiles };
    }
    return { landed: false, reason: `cannot compare ${branch} against ${baseRef}`, evidence, untrackedFiles };
  }

  return { landed: false, reason: 'no merged pull request and commits are not on any remote', evidence, untrackedFiles };
}

export interface UnlandedInput {
  repoPath: string | null;
  worktreePath: string | null;
  branch: string | null;
  landingBranch: string;
}

/**
 * How many commits on the ticket branch are missing from the landing branch — the task-done gate's
 * input (VS-215). "Landed" means ancestry (fast-forward or merge commit) or a patch-id equivalent
 * (squash/rebase merge), the same rule landedWorkTest applies. Unreadable state counts 0: this gate
 * may only refuse what it can prove, and a stranded worktree is still protected by the landed-work
 * test and the discard rules.
 */
export async function unlandedCommitCount(input: UnlandedInput, log?: { warn: (obj: object, msg: string) => void }): Promise<number> {
  const { repoPath, worktreePath, branch, landingBranch } = input;
  if (!worktreePath || !branch || !existsSync(worktreePath)) return 0;
  if (!repoPath || !existsSync(repoPath)) return 0;
  const baseRef = (await resolveBaseRef(repoPath, landingBranch)) ?? landingBranch;
  const ancestor = await git(['merge-base', '--is-ancestor', branch, baseRef], repoPath, 30_000);
  if (ancestor.ok) return 0;
  const cherry = await git(['cherry', baseRef, branch], repoPath, 60_000);
  if (!cherry.ok) {
    log?.warn({ branch, baseRef, err: cherry.stderr.trim().slice(0, 300) }, 'unlanded-commit check failed; allowing');
    return 0;
  }
  return cherry.stdout.split('\n').filter((l) => l.trim().startsWith('+')).length;
}
