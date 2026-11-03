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
  /** The ticket's delivery record (VS-963): a recorded merge is checked against the checkout's HEAD before any ref test. */
  delivery?: Record<string, unknown> | null;
  /** The ticket's OpenSpec change, whose directory the daemon's archive rewrites in the merged result. */
  changeName?: string | null;
}
export interface LandedVerdict {
  landed: boolean;
  reason: string;
  evidence: Record<string, unknown>;
  /** Relative paths of the untracked files present when the verdict was reached (VS-333). */
  untrackedFiles?: string[];
  /** VS-963: the ticket records a merge this copy could not be checked against (`landing_unverified`). */
  unverified?: boolean;
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

  const withLeftovers = (reason: string): LandedVerdict => ({
    landed: true,
    reason: untrackedFiles.length ? `${reason}; ${untrackedFiles.length} untracked file(s) will be archived` : reason,
    evidence,
    untrackedFiles,
  });

  // VS-963: the ticket's own merge record first. It reads the checkout's HEAD, so a branch deleted
  // after the merge (or by a history rewrite) no longer makes finished work look unlanded.
  if (input.delivery !== undefined) {
    const proof = await recordedLandingProof({ repoPath, worktreePath, delivery: input.delivery, changeName: input.changeName ?? null });
    if (proof.kind !== 'none') {
      Object.assign(evidence, proof.evidence, { proof: 'recorded_merge' });
      if (proof.kind === 'landed') return withLeftovers(proof.reason);
      if (proof.kind === 'unlanded') return { landed: false, reason: proof.reason, evidence, untrackedFiles };
      return { landed: false, unverified: true, reason: `merge recorded but this copy cannot be verified: ${proof.reason}`, evidence, untrackedFiles };
    }
  }

  const branchOk = await git(['rev-parse', '--verify', '--quiet', branch], repoPath, 15_000);
  if (!branchOk.ok || !branchOk.stdout.trim()) return { landed: false, reason: `branch ${branch} not found in ${repoPath}`, evidence, untrackedFiles };
  evidence.head = branchOk.stdout.trim();

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

/** What a ticket's delivery says about its merge (VS-963); null when it records none. */
export interface RecordedMerge { prHead: string | null; mergeCommit: string | null }

export function recordedMergeOf(delivery: Record<string, unknown> | null | undefined): RecordedMerge | null {
  if (!delivery || delivery['merged'] !== true) return null;
  const sha = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v.trim()) ? v.trim() : null);
  return { prHead: sha(delivery['prHead']), mergeCommit: sha(delivery['mergeCommit']) ?? sha(delivery['landedSha']) };
}

export type RecordedLandingProof =
  | { kind: 'none' }
  | { kind: 'landed'; reason: string; evidence: Record<string, unknown> }
  /** Commits made after the recorded merge; `commitsAfterMerge` is null when no PR head is recorded to count from. */
  | { kind: 'unlanded'; reason: string; commitsAfterMerge: number | null; evidence: Record<string, unknown> }
  | { kind: 'unverified'; reason: string; evidence: Record<string, unknown> };

const PATHSPEC_CHUNK = 400;

async function isCommit(repo: string, sha: string): Promise<boolean> {
  return (await git(['cat-file', '-e', `${sha}^{commit}`], repo, 15_000)).ok;
}
async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  return (await git(['merge-base', '--is-ancestor', a, b], repo, 30_000)).ok;
}

/**
 * Paths the checkout changed since it forked from the merge commit's first parent whose content in
 * the merge commit differs from HEAD's, or null when git cannot say. The ticket's own OpenSpec change
 * directory and `openspec/specs/` are left out: the daemon's archive moves and rewrites them in the
 * merged result.
 */
async function pathsNotInMerge(repo: string, head: string, mergeCommit: string, changeName: string | null): Promise<{ changed: number; differing: string[] } | null> {
  const fork = await git(['merge-base', head, `${mergeCommit}^1`], repo, 30_000);
  if (!fork.ok || !fork.stdout.trim()) return null;
  const excludes = [':(exclude)openspec/specs', ...(changeName ? [`:(exclude)openspec/changes/${changeName}`] : [])];
  const names = await git(['diff', '--name-only', '-z', '--no-renames', fork.stdout.trim(), head, '--', '.', ...excludes], repo, 60_000);
  if (!names.ok) return null;
  const changed = names.stdout.split('\0').filter((p) => p.length > 0);
  const differing: string[] = [];
  for (let i = 0; i < changed.length; i += PATHSPEC_CHUNK) {
    const chunk = changed.slice(i, i + PATHSPEC_CHUNK).map((p) => `:(literal)${p}`);
    const diff = await git(['diff', '--name-only', '-z', '--no-renames', mergeCommit, head, '--', ...chunk], repo, 60_000);
    if (!diff.ok) return null;
    differing.push(...diff.stdout.split('\0').filter((p) => p.length > 0));
  }
  return { changed: changed.length, differing };
}

/**
 * VS-963 (`worker-landing-proof`): decide from the ticket's recorded merge whether a checkout's
 * committed work landed. `mergeDone` writes `delivery.merged` only after verifying the landing, so
 * the record is the authority; the checkout is bound to it by its HEAD — contained in the recorded
 * PR head, or contained (by ancestry or per-path content) in the recorded merge commit. Nothing here
 * reads a branch or a remote ref, and nothing calls the forge.
 */
export async function recordedLandingProof(input: { repoPath: string; worktreePath: string; delivery: Record<string, unknown> | null | undefined; changeName: string | null }): Promise<RecordedLandingProof> {
  const rec = recordedMergeOf(input.delivery);
  if (!rec) return { kind: 'none' };
  const { repoPath } = input;
  const evidence: Record<string, unknown> = { recordedPrHead: rec.prHead, recordedMergeCommit: rec.mergeCommit };
  const headR = await git(['rev-parse', 'HEAD'], input.worktreePath, 15_000);
  const head = headR.ok ? headR.stdout.trim() : '';
  if (!head) return { kind: 'unverified', reason: 'the checkout HEAD cannot be read', evidence };
  evidence.checkoutHead = head;

  let commitsAfterMerge: number | null = null;
  if (rec.prHead && (await isCommit(repoPath, rec.prHead))) {
    if (await isAncestor(repoPath, head, rec.prHead)) {
      return { kind: 'landed', reason: `the checkout HEAD is contained in the merged pull request head ${rec.prHead.slice(0, 12)}`, evidence };
    }
    const after = await git(['rev-list', '--count', `${rec.prHead}..${head}`], repoPath, 30_000);
    const n = after.ok ? Number(after.stdout.trim()) : NaN;
    commitsAfterMerge = Number.isFinite(n) ? n : null;
    evidence.commitsAfterMerge = commitsAfterMerge;
  }

  const mc = rec.mergeCommit && (await isCommit(repoPath, rec.mergeCommit)) ? rec.mergeCommit : null;
  if (mc) {
    if (await isAncestor(repoPath, head, mc)) return { kind: 'landed', reason: `the checkout HEAD is an ancestor of the recorded merge commit ${mc.slice(0, 12)}`, evidence };
    const paths = await pathsNotInMerge(repoPath, head, mc, input.changeName);
    if (paths) {
      evidence.pathsChanged = paths.changed;
      evidence.pathsDiffering = paths.differing.length;
      if (paths.differing.length === 0) {
        return { kind: 'landed', reason: `every path the checkout changed (${paths.changed}) is identical in the recorded merge commit ${mc.slice(0, 12)}`, evidence };
      }
      if (commitsAfterMerge && commitsAfterMerge > 0) {
        return { kind: 'unlanded', commitsAfterMerge, reason: `${commitsAfterMerge} commit(s) were made after the recorded merge`, evidence };
      }
      const sample = paths.differing.slice(0, 5).join(', ');
      return { kind: 'unverified', reason: `${paths.differing.length} path(s) differ from the recorded merge commit ${mc.slice(0, 12)}: ${sample}`, evidence };
    }
  }
  if (commitsAfterMerge && commitsAfterMerge > 0) {
    return { kind: 'unlanded', commitsAfterMerge, reason: `${commitsAfterMerge} commit(s) were made after the recorded merge`, evidence };
  }
  if (mc) return { kind: 'unverified', reason: `cannot compare the checkout with the recorded merge commit ${mc.slice(0, 12)}`, evidence };
  const recorded = [rec.prHead && `pull request head ${rec.prHead.slice(0, 12)}`, rec.mergeCommit && `merge commit ${rec.mergeCommit.slice(0, 12)}`].filter(Boolean);
  return { kind: 'unverified', reason: recorded.length ? `the project clone does not hold the recorded ${recorded.join(' or ')}` : 'the merge record names no pull request head or merge commit', evidence };
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
