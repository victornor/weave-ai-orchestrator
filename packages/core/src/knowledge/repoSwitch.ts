/**
 * VS-359: moving an existing project's knowledge into or out of its own repository. Both directions
 * are one reviewed pull request, built on the scratch-worktree and forge primitives VS-358 already
 * uses for out-of-ticket writes — the flag itself is flipped only when the pull request resolves,
 * never when the switch is requested. The workspace copy is the source on the way in and is left
 * untouched on the way out, so neither direction loses anything.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { nowIso } from '@weave-ai/db';
import { OcError, landingBranchOf, type Project, type ProjectKnowledgeSwitch } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import { createSerializer } from '../util/serialize.js';
import { isFreshAgainstLanding, rebaseOntoLanding, scratchBranchFrom, scratchLandWorktree } from '../tickets/archive-before-merge.js';
import { repoKnowledgePath } from './files.js';

export type KnowledgeSwitchDirection = 'on' | 'off';

/** VS-359: the branch a switch lives on. One per direction, so a stale closed branch for the other direction can never carry content into a new switch. */
function switchBranch(project: Project, direction: KnowledgeSwitchDirection): string {
  return `ac/knowledge-${project.slug}-${direction}`;
}

/**
 * Two switches for one project must not race the scratch worktrees — a second `git worktree add`
 * for the same branch, or two `createPullRequest` calls, would collide. Mirrors the per-project
 * lock VS-358's out-of-ticket delivery uses.
 */
const switchLock = createSerializer();

/** `direct` means there was nothing to review (the repository already matched), so the caller applies the flag with no PR. */
export type StartSwitchResult = { kind: 'pr' } | { kind: 'direct' };

/**
 * Copies `srcRoot` (a project's own `knowledge/projects/<slug>/**`) into `<worktreePath>/.weave/knowledge/`.
 * Every path is mapped through `repoKnowledgePath`, the single enforcement point that refuses
 * anything outside this project's own scope — so a workspace file, the shared file, the decisions
 * log or another project's file can never reach a repository, whatever the walk is handed.
 */
export function copyProjectKnowledgeIntoRepo(srcRoot: string, projectSlug: string, worktreePath: string): void {
  if (!existsSync(srcRoot)) return;
  const walk = (dirAbs: string): void => {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      const abs = join(dirAbs, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile()) continue;
      const relFromProject = relative(srcRoot, abs).split(sep).join('/');
      const repoRel = repoKnowledgePath(`projects/${projectSlug}/${relFromProject}`, projectSlug);
      const dest = join(worktreePath, '.weave', 'knowledge', repoRel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(abs));
    }
  };
  walk(srcRoot);
}

/** Rewrite the scratch worktree's `.weave/knowledge/` to the state `direction` wants. */
function applyDesiredTree(ctx: WorkspaceContext, project: Project, direction: KnowledgeSwitchDirection, worktreePath: string): void {
  const destRoot = join(worktreePath, '.weave', 'knowledge');
  rmSync(destRoot, { recursive: true, force: true });
  if (direction === 'off') return;
  copyProjectKnowledgeIntoRepo(join(ctx.paths.knowledge, 'projects', project.slug), project.slug, worktreePath);
}

function recordSwitch(ctx: WorkspaceContext, project: Project, direction: KnowledgeSwitchDirection, branch: string, prUrl: string): void {
  const knowledgeSwitch: ProjectKnowledgeSwitch = { direction, branch, prUrl, startedAt: nowIso() };
  ctx.db.update('projects', project.id, { knowledgeSwitchJson: knowledgeSwitch });
}

/**
 * Start (or resume) the switch of `project`'s knowledge-repo opt-in in `direction`. Returns after the
 * pull request exists and the pending switch is recorded, or `{ kind: 'direct' }` when the repository
 * already matched — the caller then flips the flag immediately rather than opening an empty PR. A
 * forge that cannot open a pull request throws, leaving the flag and the project record untouched.
 */
export async function startKnowledgeRepoSwitch(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  direction: KnowledgeSwitchDirection,
): Promise<StartSwitchResult> {
  return switchLock(project.id, () => startLocked(ctx, deps, project, direction));
}

async function startLocked(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  project: Project,
  direction: KnowledgeSwitchDirection,
): Promise<StartSwitchResult> {
  const forge = ctx.registries.forges.get('github');
  if (!forge?.createPullRequest) {
    throw new OcError('internal', 'no forge available that can open the knowledge-repo switch pull request', { project: project.slug });
  }
  const branch = switchBranch(project, direction);
  const landing = landingBranchOf(project);

  // A crash after the push, or a previous attempt, may already have the pull request: reuse it
  // rather than opening a second one (acceptance: exactly one PR).
  const existing = forge.pullRequestForBranch ? await forge.pullRequestForBranch(project.clonePath, branch) : null;
  if (existing) {
    recordSwitch(ctx, project, direction, branch, existing.url);
    return { kind: 'pr' };
  }

  const hasBranch = (await git(['ls-remote', '--exit-code', '--heads', 'origin', branch], project.clonePath, 60_000)).ok;
  const scratch = hasBranch
    ? await scratchLandWorktree(project.clonePath, branch)
    : await (async () => { try { await deps().projects.fetch(project.id); } catch { /* best effort: the scratch branch below still fetches what it needs */ } return scratchBranchFrom(project.clonePath, 'HEAD', branch); })();

  try {
    if (hasBranch) {
      await git(['fetch', 'origin', landing], project.clonePath, 300_000);
      const landingRef = `origin/${landing}`;
      const fresh = await isFreshAgainstLanding(scratch.path, 'HEAD', landingRef);
      if (!fresh) {
        const rebased = await rebaseOntoLanding(scratch.path, landingRef);
        if (!rebased.ok) {
          throw new OcError('internal', `the switch branch ${branch} conflicts with ${landing}; close the pull request and try again: ${rebased.detail}`, { project: project.slug, branch });
        }
      }
    }
    applyDesiredTree(ctx, project, direction, scratch.path);

    const add = await git(['add', '-A'], scratch.path, 30_000);
    if (!add.ok) throw new OcError('internal', `git add of the knowledge switch failed: ${add.stderr.trim().slice(0, 300)}`, { project: project.slug });
    const status = await git(['status', '--porcelain'], scratch.path, 30_000);
    const changed = Boolean(status.stdout.trim());

    // Nothing to review, and no branch to update: the repository already matches the desired state.
    if (!changed && !hasBranch) return { kind: 'direct' };

    if (changed) {
      const verb = direction === 'on' ? 'commit' : 'remove';
      const commit = await git(['-c', 'user.name=Weave AI', '-c', 'user.email=weave-ai@localhost', 'commit', '-m', `chore(knowledge): ${verb} ${project.slug} knowledge in the repository`], scratch.path, 30_000);
      if (!commit.ok) throw new OcError('internal', `git commit of the knowledge switch failed: ${commit.stderr.trim().slice(0, 300)}`, { project: project.slug });
    }

    const push = hasBranch
      ? await git(['push', '--force-with-lease', 'origin', `HEAD:${branch}`], scratch.path, 120_000)
      : await git(['push', '-u', 'origin', branch], scratch.path, 120_000);
    if (!push.ok) throw new OcError('internal', `push of the knowledge switch branch ${branch} failed: ${push.stderr.trim().slice(0, 300)}`, { project: project.slug, branch });
  } finally {
    await scratch.dispose();
  }

  const title = direction === 'on'
    ? `chore(knowledge): commit ${project.slug}'s knowledge in this repository`
    : `chore(knowledge): remove ${project.slug}'s knowledge from this repository`;
  const body = direction === 'on'
    ? `Moves ${project.slug}'s workspace knowledge into \`.weave/knowledge/\` so this repository becomes its reviewed home. The project's setting turns on when this pull request merges; closing it without merging leaves the setting off.`
    : `Removes ${project.slug}'s \`.weave/knowledge/\` tree. The workspace keeps its own copy, so nothing is lost. The project's setting turns off when this pull request merges; closing it without merging leaves the setting on.`;
  const pr = await forge.createPullRequest(project.clonePath, { branch, base: landing, title, body });
  recordSwitch(ctx, project, direction, branch, pr.url);
  return { kind: 'pr' };
}
