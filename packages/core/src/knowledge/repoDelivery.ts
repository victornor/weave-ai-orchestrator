/**
 * VS-358: a weaver's out-of-ticket knowledge write to an opted-in project's repo. No ticket, no
 * worktree already exists — this opens (or updates) a daemon-managed pull request, reusing the
 * scratch-worktree primitives `archive-before-merge.ts` already built for OpenSpec archive backfill,
 * rather than pushing straight to the landing branch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OcError, landingBranchOf, type Project } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import { isFreshAgainstLanding, rebaseOntoLanding, scratchBranchFrom, scratchLandWorktree } from '../tickets/archive-before-merge.js';
import { createSerializer } from '../util/serialize.js';
import { readMirrorFile } from './files.js';

/** One project's daemon-managed out-of-ticket knowledge branch, so a second write finds and reuses it. */
function branchFor(project: Project): string {
  return `ac/knowledge-${project.slug}`;
}

/**
 * VS-358 (plan review round 2): `requestKnowledgeRepoPr` is fire-and-forget, so two weaver writes in
 * one turn (or a weaver write racing curation) can both see no remote branch and both push, or both
 * take the existing-branch path and collide on `--force-with-lease` — the failed one only logs, so it
 * silently never reaches the repo. A dedicated serializer, never the ticket-landing `landLock` (this
 * must never queue behind, or block, a merge), makes every write for one project run one at a time,
 * so each sees the previous one's already-pushed branch.
 */
const knowledgeRepoLock = createSerializer();

/**
 * Commits the result of `computeBody(current)` at `.weave/knowledge/<repoRelPath>` in `project`'s
 * repo, on that project's own out-of-ticket knowledge branch, and opens a pull request against its
 * landing branch — updating the existing branch and PR when one is already open (a second write
 * before the first merges must not lose the first commit), opening fresh from the landing tip
 * otherwise. `current` is that branch's *own* current copy of the file (or `''` when it has none yet)
 * — never the shared workspace body, which by the time this runs may already carry another ticket's
 * still-unmerged entry on the same hub or document. `computeBody` is `note()`'s own entry-applying
 * closure, or `putDoc`/`replace`'s caller-supplied body verbatim (never derived from `current`).
 */
export async function requestKnowledgeRepoPr(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  repoRelPath: string,
  computeBody: (current: string) => string,
): Promise<void> {
  return knowledgeRepoLock(project.id, () => requestKnowledgeRepoPrLocked(ctx, deps, project, repoRelPath, computeBody));
}

async function requestKnowledgeRepoPrLocked(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  repoRelPath: string,
  computeBody: (current: string) => string,
): Promise<void> {
  const branch = branchFor(project);
  const landing = landingBranchOf(project);
  const forge = ctx.registries.forges.get('github');
  if (!forge?.createPullRequest) {
    throw new OcError('internal', 'no forge available that can open the out-of-ticket knowledge pull request', { project: project.slug, branch });
  }

  const writeFile = (worktreePath: string): void => {
    const current = readMirrorFile(worktreePath, repoRelPath, '');
    const abs = join(worktreePath, '.weave', 'knowledge', repoRelPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, computeBody(current), 'utf8');
  };
  const commit = async (worktreePath: string): Promise<boolean> => {
    const add = await git(['add', '-A', '.weave/knowledge'], worktreePath, 30_000);
    if (!add.ok) throw new OcError('internal', `git add of the knowledge write failed: ${add.stderr.trim().slice(0, 300)}`, { project: project.slug });
    const result = await git(['commit', '-m', `chore(knowledge): update ${repoRelPath}`], worktreePath, 30_000);
    if (result.ok) return true;
    if (/nothing to commit|no changes added/i.test(`${result.stdout} ${result.stderr}`)) return false;
    throw new OcError('internal', `git commit of the knowledge write failed: ${result.stderr.trim().slice(0, 300)}`, { project: project.slug });
  };

  const existingBranch = await git(['ls-remote', '--exit-code', '--heads', 'origin', branch], project.clonePath, 60_000);
  if (existingBranch.ok && existingBranch.stdout.trim()) {
    // A write is already pending on this project's knowledge branch: rebase and commit onto it
    // rather than recreating it from the landing tip, which would push over (and lose) that commit.
    const scratch = await scratchLandWorktree(project.clonePath, branch);
    try {
      await git(['fetch', 'origin', landing], project.clonePath, 300_000);
      const landingRef = `origin/${landing}`;
      const fresh = await isFreshAgainstLanding(scratch.path, 'HEAD', landingRef);
      if (!fresh) {
        const rebased = await rebaseOntoLanding(scratch.path, landingRef);
        if (!rebased.ok) throw new OcError('internal', `${branch} conflicts with ${landing}; the daemon cannot resolve this on its own: ${rebased.detail}`, { project: project.slug, branch });
      }
      writeFile(scratch.path);
      const changed = await commit(scratch.path);
      if (changed || !fresh) {
        const push = await git(['push', '--force-with-lease', 'origin', `HEAD:${branch}`], scratch.path, 120_000);
        if (!push.ok) throw new OcError('internal', `push of ${branch} failed: ${push.stderr.trim().slice(0, 300)}`, { project: project.slug, branch });
      }
    } finally {
      await scratch.dispose();
    }
  } else {
    try { await deps().projects.fetch(project.id); } catch { /* best effort: the scratch branch below still fetches what it needs */ }
    const scratch = await scratchBranchFrom(project.clonePath, 'HEAD', branch);
    try {
      writeFile(scratch.path);
      await commit(scratch.path);
      const push = await git(['push', '-u', 'origin', branch], scratch.path, 120_000);
      if (!push.ok) throw new OcError('internal', `push of ${branch} failed: ${push.stderr.trim().slice(0, 300)}`, { project: project.slug, branch });
    } finally {
      await scratch.dispose();
    }
  }

  const pending = forge.pullRequestForBranch ? await forge.pullRequestForBranch(project.clonePath, branch) : null;
  if (!pending) {
    await forge.createPullRequest(project.clonePath, {
      branch, base: landing, title: `chore(knowledge): ${project.slug} knowledge update`,
      body: `Knowledge written outside a ticket for ${project.slug}, delivered through this pull request rather than a direct push.`,
    });
  }
}
