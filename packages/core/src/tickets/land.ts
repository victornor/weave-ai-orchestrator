import { OcError, landingBranchOf, type Project, type Ticket, type WorkspaceConfig } from '@weave-ai/shared';
import { git } from '../util/git.js';

/** `landing` is the branch the work landed on; `landingHead` is that branch's commit that contains it (VS-568). */
export interface LandResult { mode: 'pr' | 'local-branch'; landed: boolean; head: string | null; detail: string; landing: string; landingHead: string | null }
export interface LandOpts { mergeCommit?: string }

type MergeCommitStatus = 'ancestor' | 'not_ancestor' | 'unresolvable' | 'omitted';
type StrategyOutcome = 'passed' | 'failed' | 'skipped';
interface VerifyStrategy { name: string; outcome: StrategyOutcome }

/** The patch id of a diff, stable across rebases and cherry-picks. Empty when the diff is empty. */
async function patchId(clone: string, diffArgs: string[]): Promise<string | null> {
  const diff = await git(diffArgs, clone, 120_000);
  if (!diff.ok || !diff.stdout.trim()) return null;
  const id = await git(['patch-id', '--stable'], clone, 60_000, diff.stdout);
  const first = id.stdout.trim().split(/\s+/)[0];
  return id.ok && first ? first : null;
}

async function revParse(clone: string, rev: string): Promise<string | null> {
  const r = await git(['rev-parse', '--verify', '--quiet', rev], clone);
  const sha = r.stdout.trim();
  return r.ok && sha ? sha : null;
}

/**
 * Is the branch's content on its landing branch? Merge-commit ancestry first (VS-232), then the four
 * content checks, cheapest first. The returned `detail` names the check that passed; `null` means
 * the work has not landed. Failure always fills `strategies` so `merge_unverified` can say what it
 * compared.
 *
 * Merge-commit ancestry is the squash whose parent is not the branch's merge-base (another PR landed
 * first). Branch-head ancestry is the ordinary merge. Tree equality is the squash that was the last
 * thing to land. The squash patch id catches the same squash once other work landed on top — the case
 * `git cherry` alone gets wrong, because a squash collapses N commits into one commit whose patch id
 * matches none of theirs. `git cherry` stays last: it is the only check that recognises commits
 * cherry-picked one at a time.
 */
async function verifyContained(
  clone: string,
  branchHead: string,
  upstream: string,
  mergeCommit: string | undefined,
): Promise<{ detail: string | null; mergeCommitStatus: MergeCommitStatus; strategies: VerifyStrategy[] }> {
  const strategies: VerifyStrategy[] = [];
  let mergeCommitStatus: MergeCommitStatus = 'omitted';

  if (!mergeCommit) {
    strategies.push({ name: 'merge-commit ancestry', outcome: 'skipped' });
  } else {
    const sha = await revParse(clone, `${mergeCommit}^{commit}`) ?? await revParse(clone, mergeCommit);
    if (!sha) {
      mergeCommitStatus = 'unresolvable';
      strategies.push({ name: 'merge-commit ancestry', outcome: 'failed' });
    } else if ((await git(['merge-base', '--is-ancestor', sha, upstream], clone)).ok) {
      mergeCommitStatus = 'ancestor';
      strategies.push({ name: 'merge-commit ancestry', outcome: 'passed' });
      return { detail: `${upstream} contains merge commit ${sha.slice(0, 12)}`, mergeCommitStatus, strategies };
    } else {
      mergeCommitStatus = 'not_ancestor';
      strategies.push({ name: 'merge-commit ancestry', outcome: 'failed' });
    }
  }

  if (!branchHead) {
    for (const name of ['branch-head ancestry', 'identical trees', 'squash patch-id', 'cherry'] as const) {
      strategies.push({ name, outcome: 'skipped' });
    }
    return { detail: null, mergeCommitStatus, strategies };
  }

  if ((await git(['merge-base', '--is-ancestor', branchHead, upstream], clone)).ok) {
    strategies.push({ name: 'branch-head ancestry', outcome: 'passed' });
    return { detail: `${upstream} contains the branch head`, mergeCommitStatus, strategies };
  }
  strategies.push({ name: 'branch-head ancestry', outcome: 'failed' });

  if ((await git(['diff', '--quiet', branchHead, upstream], clone)).ok) {
    strategies.push({ name: 'identical trees', outcome: 'passed' });
    return { detail: `${upstream} and the branch have identical trees (squash)`, mergeCommitStatus, strategies };
  }
  strategies.push({ name: 'identical trees', outcome: 'failed' });

  const base = (await git(['merge-base', upstream, branchHead], clone)).stdout.trim();
  if (base) {
    const branchPatch = await patchId(clone, ['diff', base, branchHead]);
    if (branchPatch) {
      const gained = await git(['rev-list', upstream, `^${base}`], clone, 120_000);
      for (const sha of gained.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (await patchId(clone, ['diff-tree', '-p', sha]) === branchPatch) {
          strategies.push({ name: 'squash patch-id', outcome: 'passed' });
          return { detail: `the branch landed on ${upstream} as squash commit ${sha.slice(0, 12)}`, mergeCommitStatus, strategies };
        }
      }
      strategies.push({ name: 'squash patch-id', outcome: 'failed' });
    } else {
      strategies.push({ name: 'squash patch-id', outcome: 'skipped' });
    }
  } else {
    strategies.push({ name: 'squash patch-id', outcome: 'skipped' });
  }

  const cherry = await git(['cherry', upstream, branchHead], clone);
  if (cherry.ok && !cherry.stdout.split('\n').some((l) => l.startsWith('+'))) {
    strategies.push({ name: 'cherry', outcome: 'passed' });
    return { detail: `every commit of the branch is present on ${upstream}`, mergeCommitStatus, strategies };
  }
  strategies.push({ name: 'cherry', outcome: cherry.ok ? 'failed' : 'skipped' });

  return { detail: null, mergeCommitStatus, strategies };
}

/**
 * Land a ticket's delivery into the primary clone before archiving (PLAN §11.3/§12.2 step 7):
 * - `local-branch`: fast-forward the ticket's landing branch to the ticket branch (refuse when not fast-forwardable).
 * - `pr`: fetch and verify the ticket's landing branch already carries the ticket branch's content (the worker merged the PR on the forge).
 *
 * The landing branch is the ticket's own declaration if it has one, else the project's, else the
 * project's default branch (VS-119, `landingBranchOf`) — never inferred from where the PR was opened.
 *
 * `opts.mergeCommit` is a SHA the caller already authenticated as *this PR's* forge merge
 * commit (VS-232). Ancestry of that SHA on the landing branch is proof. Ancestry of an arbitrary
 * SHA already on the landing branch is not — `mergeDone` must never forward a worker-reported SHA
 * the forge has not confirmed, including when the forge is unreachable. An unresolvable or
 * non-ancestor SHA is not a throw by itself — content strategies still run.
 *
 * The caller serialises this per project (PLAN §11.4): it mutates the one clone every ticket shares.
 */
export async function landDelivery(config: WorkspaceConfig, project: Project, ticket: Ticket, branch: string, opts?: LandOpts): Promise<LandResult> {
  const mode = ((project.policies as { deliveryMode?: string } | null)?.deliveryMode ?? config.defaults.deliveryMode) as 'pr' | 'local-branch';
  const clone = project.clonePath;
  const landing = landingBranchOf(project, ticket);
  if (mode === 'local-branch') {
    const onLanding = await git(['checkout', landing], clone);
    if (!onLanding.ok) throw new OcError('merge_unverified', `primary clone cannot check out ${landing}: ${onLanding.stderr.trim().slice(0, 200)}`, { branch, landing, stderr: onLanding.stderr.trim().slice(0, 300) });
    const ff = await git(['merge', '--ff-only', branch], clone, 120_000);
    if (!ff.ok) throw new OcError('merge_unverified', `branch ${branch} is not fast-forwardable onto ${landing}; rebase it onto ${landing} and retry`, { branch, landing, stderr: ff.stderr.trim().slice(0, 300) });
    const head = (await git(['rev-parse', 'HEAD'], clone)).stdout.trim();
    return { mode, landed: true, head, detail: `fast-forwarded ${landing} to ${branch}`, landing, landingHead: head || null };
  }
  // pr mode: the worker merged on the forge; verify by fetching and checking what the branch left behind.
  await git(['fetch', 'origin'], clone, 300_000);
  await git(['merge', '--ff-only', `origin/${landing}`], clone, 120_000);
  const landingRef = `origin/${landing}`;
  const branchHead = (await git(['rev-parse', branch], clone)).stdout.trim();
  const landingHead = (await revParse(clone, landingRef)) ?? (await revParse(clone, landing));
  const attempt = await verifyContained(clone, branchHead, landingRef, opts?.mergeCommit);
  if (attempt.detail) return { mode, landed: true, head: branchHead || null, detail: attempt.detail, landing, landingHead };

  const details = {
    branch,
    branchHead: branchHead || null,
    landing: landingRef,
    landingHead,
    mergeCommit: opts?.mergeCommit ?? null,
    mergeCommitStatus: attempt.mergeCommitStatus,
    strategies: attempt.strategies,
  };
  const named = opts?.mergeCommit?.trim();
  const message = attempt.mergeCommitStatus === 'not_ancestor' || attempt.mergeCommitStatus === 'unresolvable'
    ? `${landingRef} does not contain merge commit ${named}; landing head is ${landingHead ?? 'unknown'}`
    : `${landingRef} does not contain ${branch} yet; merge the PR first (or wait for the forge), then report again`;
  throw new OcError('merge_unverified', message, details);
}
