import { OcError, landingBranchOf, type Project, type Ticket, type WorkspaceConfig } from '@agent-conductor/shared';
import { git } from '../util/git.js';

export interface LandResult { mode: 'pr' | 'local-branch'; landed: boolean; head: string | null; detail: string }

/** The patch id of a diff, stable across rebases and cherry-picks. Empty when the diff is empty. */
async function patchId(clone: string, diffArgs: string[]): Promise<string | null> {
  const diff = await git(diffArgs, clone, 120_000);
  if (!diff.ok || !diff.stdout.trim()) return null;
  const id = await git(['patch-id', '--stable'], clone, 60_000, diff.stdout);
  const first = id.stdout.trim().split(/\s+/)[0];
  return id.ok && first ? first : null;
}

/**
 * Is the branch's content on its landing branch? Four checks, cheapest first; the returned string
 * names the one that passed, and null means the work has not landed.
 *
 * The order matters. Ancestry is the ordinary merge. Tree equality is the squash that was the last
 * thing to land. The squash patch id catches the same squash once other work landed on top — the case
 * `git cherry` alone gets wrong, because a squash collapses N commits into one commit whose patch id
 * matches none of theirs, so every commit of a multi-commit branch comes back unmerged. `git cherry`
 * stays last: it is the only check that recognises commits cherry-picked one at a time.
 */
async function verifyContained(clone: string, branchHead: string, upstream: string): Promise<string | null> {
  if ((await git(['merge-base', '--is-ancestor', branchHead, upstream], clone)).ok) return `${upstream} contains the branch head`;

  if ((await git(['diff', '--quiet', branchHead, upstream], clone)).ok) return `${upstream} and the branch have identical trees (squash)`;

  const base = (await git(['merge-base', upstream, branchHead], clone)).stdout.trim();
  if (base) {
    const branchPatch = await patchId(clone, ['diff', base, branchHead]);
    if (branchPatch) {
      const gained = await git(['rev-list', upstream, `^${base}`], clone, 120_000);
      for (const sha of gained.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (await patchId(clone, ['diff-tree', '-p', sha]) === branchPatch) return `the branch landed on ${upstream} as squash commit ${sha.slice(0, 12)}`;
      }
    }
  }

  const cherry = await git(['cherry', upstream, branchHead], clone);
  if (cherry.ok && !cherry.stdout.split('\n').some((l) => l.startsWith('+'))) return `every commit of the branch is present on ${upstream}`;

  return null;
}

/**
 * Land a ticket's delivery into the primary clone before archiving (PLAN §11.3/§12.2 step 7):
 * - `local-branch`: fast-forward the ticket's landing branch to the ticket branch (refuse when not fast-forwardable).
 * - `pr`: fetch and verify the ticket's landing branch already carries the ticket branch's content (the worker merged the PR on the forge).
 *
 * The landing branch is the ticket's own declaration if it has one, else the project's, else the
 * project's default branch (VS-119, `landingBranchOf`) — never inferred from where the PR was opened.
 *
 * The caller serialises this per project (PLAN §11.4): it mutates the one clone every ticket shares.
 */
export async function landDelivery(config: WorkspaceConfig, project: Project, ticket: Ticket, branch: string): Promise<LandResult> {
  const mode = ((project.policies as { deliveryMode?: string } | null)?.deliveryMode ?? config.defaults.deliveryMode) as 'pr' | 'local-branch';
  const clone = project.clonePath;
  const landing = landingBranchOf(project, ticket);
  if (mode === 'local-branch') {
    const onLanding = await git(['checkout', landing], clone);
    if (!onLanding.ok) throw new OcError('merge_unverified', `primary clone cannot check out ${landing}: ${onLanding.stderr.trim().slice(0, 200)}`);
    const ff = await git(['merge', '--ff-only', branch], clone, 120_000);
    if (!ff.ok) throw new OcError('merge_unverified', `branch ${branch} is not fast-forwardable onto ${landing}; rebase it onto ${landing} and retry`, { stderr: ff.stderr.trim().slice(0, 300) });
    const head = (await git(['rev-parse', 'HEAD'], clone)).stdout.trim();
    return { mode, landed: true, head, detail: `fast-forwarded ${landing} to ${branch}` };
  }
  // pr mode: the worker merged on the forge; verify by fetching and checking what the branch left behind.
  await git(['fetch', 'origin'], clone, 300_000);
  await git(['merge', '--ff-only', `origin/${landing}`], clone, 120_000);
  const branchHead = (await git(['rev-parse', branch], clone)).stdout.trim();
  if (branchHead) {
    const detail = await verifyContained(clone, branchHead, `origin/${landing}`);
    if (detail) return { mode, landed: true, head: branchHead, detail };
  }
  throw new OcError('merge_unverified', `origin/${landing} does not contain ${branch} yet; merge the PR first (or wait for the forge), then report again`);
}
