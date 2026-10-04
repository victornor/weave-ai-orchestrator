import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { git } from '../util/git.js';

/** VS-770: why a branch is, or is not, safe to delete. `quiet` keeps are expected and not worth a ticket comment. */
export type BranchVerdict = { delete: true } | { delete: false; reason: string; quiet?: boolean };

export interface BranchEvaluation {
  forge: ForgeAdapter;
  cwd: string;
  branch: string;
  /** Default branch, landing branch(es) and anything else that must never be deleted. */
  protectedBranches: ReadonlySet<string>;
  /** The ticket's own pull request, when it has one. */
  prUrl: string | null;
  /** The remote branch's current head, from `remoteHeads`; `null` when it is already gone. */
  remoteSha: string | null;
  /** The ref the branch must be contained in (`origin/<landing>`) for the ancestor rule. */
  landingRef: string;
}

/** `refs/heads/*` of origin as name -> sha, in one `ls-remote`. */
export async function remoteHeads(cwd: string): Promise<Map<string, string>> {
  const r = await git(['ls-remote', '--heads', 'origin'], cwd, 120_000);
  if (!r.ok) throw new Error(`git ls-remote failed: ${r.stderr.trim().slice(0, 300)}`);
  const heads = new Map<string, string>();
  for (const line of r.stdout.split('\n')) {
    const m = /^([0-9a-f]{40,64})\s+refs\/heads\/(.+)$/.exec(line.trim());
    if (m) heads.set(m[2]!, m[1]!);
  }
  return heads;
}

async function isAncestor(cwd: string, sha: string, ref: string): Promise<boolean> {
  const r = await git(['merge-base', '--is-ancestor', sha, ref], cwd, 30_000);
  return r.ok;
}

/**
 * Whether a ticket branch's remote head is contained in what landed. Two accepting cases (VS-770):
 * the forge says the PR merged and the branch head still equals the PR's head at merge — the only
 * proof available for a squash merge, whose commit never has the branch head as an ancestor — or the
 * head is an ancestor of the landing branch, which covers merge-commit and rebase projects. A commit
 * pushed after the merge fails both and keeps the branch.
 */
async function contained(e: BranchEvaluation, remoteSha: string): Promise<boolean> {
  if (await isAncestor(e.cwd, remoteSha, e.landingRef)) return true;
  if (!e.prUrl) return false;
  const state = await e.forge.prState(e.cwd, e.prUrl).catch(() => null);
  return state?.state === 'merged' && !!state.headSha && state.headSha === remoteSha;
}

/** Every guard, in order. Decides nothing about policy: callers check `deleteBranchAfterMergeEnabled` first. */
export async function evaluateBranch(e: BranchEvaluation): Promise<BranchVerdict> {
  if (e.protectedBranches.has(e.branch)) return { delete: false, reason: `${e.branch} is the default or a landing branch`, quiet: true };
  if (!e.remoteSha) return { delete: false, reason: `${e.branch} is already gone from the remote`, quiet: true };
  if (e.forge.pullRequestForBranch) {
    const open = await e.forge.pullRequestForBranch(e.cwd, e.branch).catch(() => null);
    if (open && open.url !== e.prUrl) return { delete: false, reason: `${e.branch} is the head of open pull request #${open.number}` };
  }
  if (!(await contained(e, e.remoteSha))) {
    return { delete: false, reason: `${e.branch} (${e.remoteSha.slice(0, 12)}) has commits that were not part of the merge` };
  }
  return { delete: true };
}

/** Deletes the remote branch, then the local branch and its remote-tracking ref when they linger. Local failures are ignored: a worktree still holding the branch removes it on retire. */
export async function deleteBranchEverywhere(forge: ForgeAdapter, cwd: string, branch: string): Promise<void> {
  if (!forge.deleteBranch) throw new Error(`the ${forge.id} forge cannot delete branches`);
  await forge.deleteBranch(cwd, branch);
  await git(['update-ref', '-d', `refs/remotes/origin/${branch}`], cwd, 15_000).catch(() => undefined);
  const local = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd, 15_000).catch(() => null);
  if (local?.ok) await git(['branch', '-D', branch], cwd, 15_000).catch(() => undefined);
}

/** One branch's current remote head, or `null` when the remote has no such branch. */
export async function remoteHead(cwd: string, branch: string): Promise<string | null> {
  const r = await git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], cwd, 60_000);
  if (!r.ok) throw new Error(`git ls-remote failed: ${r.stderr.trim().slice(0, 300)}`);
  const m = /^([0-9a-f]{40,64})\s/.exec(r.stdout.trim());
  return m ? m[1]! : null;
}

export type CleanupOutcome =
  | { outcome: 'deleted' }
  | { outcome: 'kept'; reason: string; quiet: boolean }
  | { outcome: 'failed'; error: string };

/** The post-merge step: evaluate, then delete. Never throws — a failure is an outcome the caller notes once. */
export async function cleanupMergedBranch(i: {
  forge: ForgeAdapter; cwd: string; branch: string; prUrl: string | null; protectedBranches: ReadonlySet<string>; landingBranch: string;
}): Promise<CleanupOutcome> {
  try {
    const verdict = await evaluateBranch({
      forge: i.forge, cwd: i.cwd, branch: i.branch, protectedBranches: i.protectedBranches, prUrl: i.prUrl,
      remoteSha: i.protectedBranches.has(i.branch) ? null : await remoteHead(i.cwd, i.branch), landingRef: `origin/${i.landingBranch}`,
    });
    if (!verdict.delete) return { outcome: 'kept', reason: verdict.reason, quiet: verdict.quiet === true };
    await deleteBranchEverywhere(i.forge, i.cwd, i.branch);
    return { outcome: 'deleted' };
  } catch (e) {
    return { outcome: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
