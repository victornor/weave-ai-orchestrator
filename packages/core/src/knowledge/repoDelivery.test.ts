import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import type { Project } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { git } from '../util/git.js';
import { requestKnowledgeRepoPr } from './repoDelivery.js';

const BRANCH = 'ac/knowledge-api';
/** A `computeBody` that ignores the branch's current content and always commits `s`, like `putDoc`/`replace`. */
const always = (s: string) => (): string => s;

describe('requestKnowledgeRepoPr (VS-358)', () => {
  let dir: string;
  let origin: string;
  let clone: string;
  let project: Project;
  let ctx: WorkspaceContext;
  let deps: () => CoreServices;
  let openedPrs: Array<{ branch: string; base: string; title: string; body?: string }>;
  let forge: ForgeAdapter;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  /** Commit subjects unique to `ref` relative to `main` — excludes the shared init commit both branches carry. */
  const log = async (repo: string, ref: string): Promise<string[]> =>
    (await git(['log', '--format=%s', `main..${ref}`], repo)).stdout.trim().split('\n').filter(Boolean);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-knowledge-repo-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');

    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');

    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);

    project = { id: 'p1', slug: 'api', clonePath: clone, defaultBranch: 'main', landingBranch: null } as Project;
    openedPrs = [];
    forge = {
      id: 'github',
      detect: async () => true,
      prState: async () => ({ state: 'open' }),
      mergePr: async () => ({}),
      createPullRequest: async (_cwd, opts) => { openedPrs.push(opts); return { url: `https://example.com/pr/${openedPrs.length}`, number: openedPrs.length }; },
      pullRequestForBranch: async (cwd, branch) => {
        const exists = await git(['ls-remote', '--exit-code', '--heads', 'origin', branch], cwd);
        return exists.ok && openedPrs.length ? { url: `https://example.com/pr/${openedPrs.length}`, number: openedPrs.length } : null;
      },
    };
    ctx = { registries: { forges: new Map([['github', forge]]) } } as unknown as WorkspaceContext;
    deps = () => ({ projects: { fetch: async () => ({ head: 'x', fastForwarded: false }) } } as unknown as CoreServices);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('opens a pull request with one commit on the first write', async () => {
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\nFirst write.\n'));

    expect(openedPrs).toHaveLength(1);
    expect(openedPrs[0]).toMatchObject({ branch: BRANCH, base: 'main' });
    const commits = await log(origin, `refs/heads/${BRANCH}`);
    expect(commits).toHaveLength(1);
    const content = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/PROJECT.md`], origin)).stdout;
    expect(content).toBe('# API\n\nFirst write.');
  });

  it('a second write to a different file adds a commit onto the same branch and PR, keeping the first', async () => {
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\nFirst write.\n'));
    await requestKnowledgeRepoPr(ctx, deps, project, 'docs/run-engine.md', always('# Run engine\n\nSecond write.\n'));

    expect(openedPrs).toHaveLength(1); // no second PR opened
    const commits = await log(origin, `refs/heads/${BRANCH}`);
    expect(commits).toHaveLength(2);
    const hub = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/PROJECT.md`], origin)).stdout;
    const doc = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/docs/run-engine.md`], origin)).stdout;
    expect(hub).toBe('# API\n\nFirst write.');
    expect(doc).toBe('# Run engine\n\nSecond write.');
  });

  it('a second write to the same file updates its content, keeping the first commit in history', async () => {
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\nFirst write.\n'));
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\nSecond write.\n'));

    expect(openedPrs).toHaveLength(1);
    const commits = await log(origin, `refs/heads/${BRANCH}`);
    expect(commits).toHaveLength(2);
    const content = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/PROJECT.md`], origin)).stdout;
    expect(content).toBe('# API\n\nSecond write.');
  });

  it("computeBody receives that branch's own current content, not a value the caller pre-mixed with anything else", async () => {
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\n## Landmines\n- landing content\n'));
    const seen: string[] = [];
    await requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', (current) => { seen.push(current); return `${current}- appended\n`; });

    expect(seen).toEqual(['# API\n\n## Landmines\n- landing content\n']);
    const content = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/PROJECT.md`], origin)).stdout;
    expect(content).toContain('landing content');
    expect(content).toContain('appended');
  });

  it('two concurrent writes to different files both end up on the one branch and PR, neither lost (plan review round 2)', async () => {
    await Promise.all([
      requestKnowledgeRepoPr(ctx, deps, project, 'PROJECT.md', always('# API\n\nFirst write.\n')),
      requestKnowledgeRepoPr(ctx, deps, project, 'docs/run-engine.md', always('# Run engine\n\nSecond write.\n')),
    ]);

    expect(openedPrs).toHaveLength(1);
    const commits = await log(origin, `refs/heads/${BRANCH}`);
    expect(commits).toHaveLength(2);
    const hub = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/PROJECT.md`], origin)).stdout;
    const doc = (await git(['show', `refs/heads/${BRANCH}:.weave/knowledge/docs/run-engine.md`], origin)).stdout;
    expect(hub).toBe('# API\n\nFirst write.');
    expect(doc).toBe('# Run engine\n\nSecond write.');
  });
});
