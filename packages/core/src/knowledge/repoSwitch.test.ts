import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import type { Project } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import { copyProjectKnowledgeIntoRepo, startKnowledgeRepoSwitch } from './repoSwitch.js';

const BRANCH_ON = 'ac/knowledge-api-on';
const BRANCH_OFF = 'ac/knowledge-api-off';

describe('startKnowledgeRepoSwitch (VS-359)', () => {
  let dir: string;
  let origin: string;
  let clone: string;
  let knowledgeRoot: string;
  let project: Project;
  let ctx: WorkspaceContext;
  let deps: () => CoreServices;
  let openedPrs: Array<{ branch: string; base: string; title: string; body?: string; draft?: boolean }>;
  let openPrs: Array<{ branch: string; url: string; number: number }>;
  let forge: ForgeAdapter;
  let recorded: Array<Record<string, unknown>>;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message], repo);
  };
  const seedKnowledge = (): void => {
    mkdirSync(join(knowledgeRoot, 'projects', 'api', 'docs', 'guides'), { recursive: true });
    mkdirSync(join(knowledgeRoot, 'projects', 'api', 'archive'), { recursive: true });
    writeFileSync(join(knowledgeRoot, 'projects', 'api', 'PROJECT.md'), '# API\n\n## Overview\n- hub\n');
    writeFileSync(join(knowledgeRoot, 'projects', 'api', 'docs', 'run-engine.md'), '# Run engine\n');
    writeFileSync(join(knowledgeRoot, 'projects', 'api', 'docs', 'guides', 'deploy.md'), '# Deploy\n');
    writeFileSync(join(knowledgeRoot, 'projects', 'api', 'archive', '2026-09-01.md'), '# archive\n');
    mkdirSync(join(knowledgeRoot, 'workspace'), { recursive: true });
    writeFileSync(join(knowledgeRoot, 'workspace', 'WORKSPACE.md'), '# workspace\n');
    writeFileSync(join(knowledgeRoot, 'workspace', 'SHARED.md'), '# shared\n');
    writeFileSync(join(knowledgeRoot, 'workspace', 'decisions.md'), '# decisions\n');
    mkdirSync(join(knowledgeRoot, 'projects', 'other'), { recursive: true });
    writeFileSync(join(knowledgeRoot, 'projects', 'other', 'PROJECT.md'), '# other\n');
  };
  const show = async (ref: string, path: string): Promise<string | null> => {
    const r = await git(['show', `${ref}:${path}`], origin);
    return r.ok ? r.stdout : null;
  };
  const subjectLog = async (ref: string): Promise<string[]> =>
    (await git(['log', '--format=%s', `main..${ref}`], origin)).stdout.trim().split('\n').filter(Boolean);
  /** VS-383: a finished switch leaves no scratch worktree registered and no directory holding one. */
  const expectNoScratch = async (): Promise<void> => {
    const listed = await git(['worktree', 'list', '--porcelain'], clone);
    const registered = listed.stdout.split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length).trim())
      .filter((p) => p.startsWith(join(dir, 'state', 'scratch')));
    expect(registered).toEqual([]);
    const root = join(dir, 'state', 'scratch');
    const leftovers: string[] = [];
    if (existsSync(root)) for (const proj of readdirSync(root)) for (const tree of readdirSync(join(root, proj))) leftovers.push(join(proj, tree));
    expect(leftovers).toEqual([]);
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-knowledge-switch-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    knowledgeRoot = join(dir, 'knowledge');

    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');

    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    seedKnowledge();
    project = { id: 'p1', slug: 'api', clonePath: clone, defaultBranch: 'main', landingBranch: null } as Project;
    openedPrs = [];
    openPrs = [];
    recorded = [];
    forge = {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'open' }),
      mergePr: async () => ({}),
      createPullRequest: async (_cwd, opts) => {
        openedPrs.push(opts);
        const url = `https://example.com/pr/${openedPrs.length}`;
        openPrs.push({ branch: opts.branch, url, number: openedPrs.length });
        return { url, number: openedPrs.length };
      },
      pullRequestForBranch: async (_cwd, branch) => {
        const found = openPrs.find((p) => p.branch === branch);
        return found ? { url: found.url, number: found.number } : null;
      },
    };
    ctx = {
      // VS-383: the scratch worktree a switch uses is created under the workspace state dir.
      paths: { knowledge: knowledgeRoot, state: join(dir, 'state') },
      db: { update: (_table: string, id: string, obj: Record<string, unknown>) => { recorded.push({ id, ...obj }); return 1; } },
      registries: { forges: new Map([['github', forge]]) },
    } as unknown as WorkspaceContext;
    deps = () => ({ projects: { fetch: async () => ({ head: 'x', fastForwarded: false }) } } as unknown as CoreServices);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('enabling opens exactly one PR containing only this project\'s .weave/knowledge tree, and records the switch', async () => {
    const result = await startKnowledgeRepoSwitch(ctx, deps, project, 'on');

    expect(result).toEqual({ kind: 'pr' });
    expect(openedPrs).toHaveLength(1);
    expect(openedPrs[0]).toMatchObject({ branch: BRANCH_ON, base: 'main' });
    // VS-393: a person merges the switch PR on GitHub, so it stays non-draft.
    expect(openedPrs[0]?.draft).toBeFalsy();
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/PROJECT.md')).toBe('# API\n\n## Overview\n- hub');
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/docs/run-engine.md')).toBe('# Run engine');
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/docs/guides/deploy.md')).toBe('# Deploy');
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/archive/2026-09-01.md')).toBe('# archive');
    // Never the workspace hub, shared file, decisions log or another project.
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/workspace/WORKSPACE.md')).toBeNull();
    expect(await show(`refs/heads/${BRANCH_ON}`, '.weave/knowledge/other/PROJECT.md')).toBeNull();
    // The PR's commit is the first git revision; nothing was replayed.
    expect(await subjectLog(`refs/heads/${BRANCH_ON}`)).toEqual(['chore(knowledge): commit api knowledge in the repository']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ id: 'p1', knowledgeSwitchJson: { direction: 'on', branch: BRANCH_ON, prUrl: 'https://example.com/pr/1' } });
    await expectNoScratch();
  });

  it('disabling opens one PR removing the tree and leaves the workspace copy untouched', async () => {
    await commit(origin, '.weave/knowledge/PROJECT.md', '# API from repo\n', 'add knowledge');
    await git(['fetch', 'origin', 'main'], clone);
    await git(['merge', '--ff-only', 'origin/main'], clone);

    const result = await startKnowledgeRepoSwitch(ctx, deps, project, 'off');

    expect(result).toEqual({ kind: 'pr' });
    expect(openedPrs[0]).toMatchObject({ branch: BRANCH_OFF, base: 'main' });
    expect(await show(`refs/heads/${BRANCH_OFF}`, '.weave/knowledge/PROJECT.md')).toBeNull();
    // The workspace copy is exactly as it was.
    expect(await show('refs/heads/main', '.weave/knowledge/PROJECT.md')).toBe('# API from repo');
    expect(recorded[0]).toMatchObject({ knowledgeSwitchJson: { direction: 'off', branch: BRANCH_OFF } });
  });

  it('a second enable while the PR is open opens no second PR and reuses the first', async () => {
    await startKnowledgeRepoSwitch(ctx, deps, project, 'on');
    await startKnowledgeRepoSwitch(ctx, deps, project, 'on');
    expect(openedPrs).toHaveLength(1);
  });

  it('re-enabling after the PR was closed reuses the branch and opens one new PR', async () => {
    await startKnowledgeRepoSwitch(ctx, deps, project, 'on');
    openPrs = []; // the human closed the PR unmerged; the branch stays on the remote
    await startKnowledgeRepoSwitch(ctx, deps, project, 'on');
    expect(openedPrs).toHaveLength(2);
    expect(openedPrs[1]).toMatchObject({ branch: BRANCH_ON });
    expect((await git(['ls-remote', '--heads', 'origin', BRANCH_ON], clone)).stdout.trim().split('\n')).toHaveLength(1);
    await expectNoScratch();
  });

  it('disabling a repository with no .weave/knowledge applies directly with no PR', async () => {
    const result = await startKnowledgeRepoSwitch(ctx, deps, project, 'off');
    expect(result).toEqual({ kind: 'direct' });
    expect(openedPrs).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('enabling when the repository already matches applies directly with no PR', async () => {
    await commit(origin, '.weave/knowledge/PROJECT.md', '# API\n\n## Overview\n- hub\n', 'already there');
    await commit(origin, '.weave/knowledge/docs/run-engine.md', '# Run engine\n', 'already there');
    await commit(origin, '.weave/knowledge/docs/guides/deploy.md', '# Deploy\n', 'already there');
    await commit(origin, '.weave/knowledge/archive/2026-09-01.md', '# archive\n', 'already there');
    await git(['fetch', 'origin', 'main'], clone);
    await git(['merge', '--ff-only', 'origin/main'], clone);
    const result = await startKnowledgeRepoSwitch(ctx, deps, project, 'on');
    expect(result).toEqual({ kind: 'direct' });
    expect(openedPrs).toHaveLength(0);
  });

  it('throws and records nothing when no forge can open a PR', async () => {
    (ctx as unknown as { registries: { forges: Map<string, ForgeAdapter> } }).registries.forges = new Map();
    await expect(startKnowledgeRepoSwitch(ctx, deps, project, 'on')).rejects.toThrow(/no forge available/);
    expect(recorded).toHaveLength(0);
  });
});

describe('copyProjectKnowledgeIntoRepo (VS-359)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-knowledge-copy-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies only the project\'s own tree, mapping every path through the repo boundary', () => {
    const src = join(dir, 'projects', 'api');
    mkdirSync(join(src, 'docs'), { recursive: true });
    writeFileSync(join(src, 'PROJECT.md'), '# api\n');
    writeFileSync(join(src, 'docs', 'a.md'), '# a\n');
    const dest = join(dir, 'worktree');
    copyProjectKnowledgeIntoRepo(src, 'api', dest);
    expect(readFileSync(join(dest, '.weave', 'knowledge', 'PROJECT.md'), 'utf8')).toBe('# api\n');
    expect(readFileSync(join(dest, '.weave', 'knowledge', 'docs', 'a.md'), 'utf8')).toBe('# a\n');
    expect(existsSync(join(dest, '.weave', 'knowledge', 'workspace'))).toBe(false);
  });
});
