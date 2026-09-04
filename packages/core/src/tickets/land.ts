import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OcError, type Project, type Ticket, type WorkspaceConfig } from '@agent-conductor/shared';

const exec = promisify(execFile);
async function git(args: string[], cwd: string, timeout = 60_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try { const r = await exec('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }); return { ok: true, stdout: r.stdout, stderr: r.stderr }; }
  catch (e) { const err = e as { stdout?: string; stderr?: string; message?: string }; return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? String(e) }; }
}

export interface LandResult { mode: 'pr' | 'local-branch'; landed: boolean; head: string | null; detail: string }

/**
 * Land a ticket's delivery into the primary clone before archiving (PLAN §11.3/§12.2 step 7):
 * - `local-branch`: fast-forward the primary clone's default branch to the ticket branch (refuse when not fast-forwardable).
 * - `pr`: fetch and verify the default branch contains the ticket branch (the worker merged the PR on the forge).
 */
export async function landDelivery(config: WorkspaceConfig, project: Project, ticket: Ticket, branch: string): Promise<LandResult> {
  const mode = ((project.policies as { deliveryMode?: string } | null)?.deliveryMode ?? config.defaults.deliveryMode) as 'pr' | 'local-branch';
  const clone = project.clonePath;
  const def = project.defaultBranch;
  if (mode === 'local-branch') {
    const onDefault = await git(['checkout', def], clone);
    if (!onDefault.ok) throw new OcError('merge_unverified', `primary clone cannot check out ${def}: ${onDefault.stderr.trim().slice(0, 200)}`);
    const ff = await git(['merge', '--ff-only', branch], clone, 120_000);
    if (!ff.ok) throw new OcError('merge_unverified', `branch ${branch} is not fast-forwardable onto ${def}; rebase it onto ${def} and retry`, { stderr: ff.stderr.trim().slice(0, 300) });
    const head = (await git(['rev-parse', 'HEAD'], clone)).stdout.trim();
    return { mode, landed: true, head, detail: `fast-forwarded ${def} to ${branch}` };
  }
  // pr mode: the worker merged on the forge; verify by fetching and checking ancestry.
  await git(['fetch', 'origin'], clone, 300_000);
  await git(['merge', '--ff-only', `origin/${def}`], clone, 120_000);
  const branchHead = (await git(['rev-parse', branch], clone)).stdout.trim();
  if (branchHead) {
    const ancestor = await git(['merge-base', '--is-ancestor', branchHead, `origin/${def}`], clone);
    if (ancestor.ok) return { mode, landed: true, head: branchHead, detail: `origin/${def} contains ${branch}` };
    // squash merges: every change on the branch must already be present on the default branch (git cherry lists unmerged commits with '+').
    const cherry = await git(['cherry', `origin/${def}`, branchHead], clone);
    if (cherry.ok && !cherry.stdout.split('\n').some((l) => l.startsWith('+'))) return { mode, landed: true, head: branchHead, detail: `all commits of ${branch} are present on origin/${def} (squash)` };
  }
  throw new OcError('merge_unverified', `origin/${def} does not contain ${branch} yet; merge the PR first (or wait for the forge), then report again`);
}
