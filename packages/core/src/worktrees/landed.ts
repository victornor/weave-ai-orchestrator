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
export interface LandedVerdict { landed: boolean; reason: string; evidence: Record<string, unknown> }

/**
 * PLAN §11.5 landed-work test. A worktree is removed only when the work has provably landed:
 * every commit on the ticket branch is reachable from a remote-tracking branch, OR the PR is merged and the
 * landing branch contains the branch's content (ancestor or patch-id match, i.e. squash merge). Uncommitted
 * changes never count as landed. When we cannot tell, the verdict is "not landed" and nothing is discarded.
 */
export async function landedWorkTest(input: LandedInput): Promise<LandedVerdict> {
  const { repoPath, worktreePath, branch, landingBranch } = input;
  const evidence: Record<string, unknown> = { branch, checkedAt: new Date().toISOString() };

  if (!existsSync(worktreePath)) return { landed: true, reason: 'worktree already absent', evidence: { ...evidence, worktree: 'absent' } };

  const status = await git(['status', '--porcelain'], worktreePath, 30_000);
  if (!status.ok) return { landed: false, reason: 'cannot read worktree status', evidence: { ...evidence, error: status.stderr.trim().slice(0, 300) } };
  const dirtyFiles = status.stdout.split('\n').filter((l) => l.trim().length > 0);
  if (dirtyFiles.length) return { landed: false, reason: `${dirtyFiles.length} uncommitted change(s) in the worktree`, evidence: { ...evidence, uncommitted: dirtyFiles.length } };

  const branchOk = await git(['rev-parse', '--verify', '--quiet', branch], repoPath, 15_000);
  if (!branchOk.ok || !branchOk.stdout.trim()) return { landed: false, reason: `branch ${branch} not found in ${repoPath}`, evidence };
  evidence.head = branchOk.stdout.trim();

  const remotes = await git(['remote'], repoPath, 15_000);
  const hasRemotes = remotes.ok && remotes.stdout.trim().length > 0;
  if (hasRemotes) {
    const unreached = await git(['rev-list', branch, '--not', '--remotes'], repoPath, 60_000);
    if (unreached.ok) {
      const commits = unreached.stdout.split('\n').filter((l) => l.trim().length > 0);
      evidence.commitsNotOnAnyRemote = commits.length;
      if (commits.length === 0) return { landed: true, reason: 'every commit on the branch is reachable from a remote-tracking branch', evidence };
    }
  }

  if (input.mergedPr || input.localBranch) {
    const baseRef = input.localBranch ? landingBranch : ((await resolveBaseRef(repoPath, landingBranch)) ?? landingBranch);
    evidence.baseRef = baseRef;
    const ancestor = await git(['merge-base', '--is-ancestor', branch, baseRef], repoPath, 30_000);
    if (ancestor.ok) return { landed: true, reason: `branch is an ancestor of ${baseRef}`, evidence };
    const cherry = await git(['cherry', baseRef, branch], repoPath, 60_000);
    if (cherry.ok) {
      const missing = cherry.stdout.split('\n').filter((l) => l.trim().startsWith('+'));
      evidence.commitsNotInBase = missing.length;
      if (missing.length === 0) return { landed: true, reason: `every commit has an equivalent patch in ${baseRef} (squash/rebase merge)`, evidence };
      return { landed: false, reason: `${missing.length} commit(s) are not contained in ${baseRef}`, evidence };
    }
    return { landed: false, reason: `cannot compare ${branch} against ${baseRef}`, evidence };
  }

  return { landed: false, reason: 'no merged pull request and commits are not on any remote', evidence };
}
