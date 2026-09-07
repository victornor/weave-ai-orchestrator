import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceConfigSchema, type Project, type Ticket, type WorkspaceConfig } from '@agent-conductor/shared';
import { git } from '../util/git.js';
import { landDelivery } from './land.js';

const BRANCH = 'ac/tst-1-dark-mode';

describe('landDelivery', () => {
  let dir: string;
  let origin: string;
  let clone: string;
  let config: WorkspaceConfig;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };

  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  const project = (over: Partial<Project> = {}): Project =>
    ({ id: 'p1', clonePath: clone, defaultBranch: 'main', landingBranch: null, policies: { deliveryMode: 'pr' }, ...over }) as Project;
  const ticket = (over: Partial<Ticket> = {}): Ticket =>
    ({ id: 't1', identifier: 'TST-1', title: 'Dark mode', landingBranch: null, ...over }) as Ticket;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-land-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    config = WorkspaceConfigSchema.parse({ version: 1, id: 'test', name: 'Test', ticketPrefix: 'TST' });

    // A bare-ish origin the clone can fetch from, seeded with one commit on main.
    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');

    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A ticket branch of several commits, left in the clone as `BRANCH`. */
  async function multiCommitBranch(): Promise<void> {
    await git(['checkout', '-b', BRANCH], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await commit(clone, 'b.ts', 'export const b = 2;\n', 'feat: b');
    await commit(clone, 'c.ts', 'export const c = 3;\n', 'feat: c');
    await git(['checkout', 'main'], clone);
  }

  /** Squash the branch onto `origin/<targetBranch>` the way `gh pr merge --squash` does. */
  async function squashMergeOnOrigin(targetBranch = 'main'): Promise<void> {
    await git(['checkout', targetBranch], origin);
    await git(['fetch', clone, `${BRANCH}:squash-src`], origin);
    await git(['merge', '--squash', 'squash-src'], origin);
    await git(['commit', '-m', 'feat: dark mode (#42)'], origin);
  }

  /** A second branch on origin, diverging from `main` at the point it is created (VS-119). */
  async function branchOnOrigin(name: string): Promise<void> {
    await git(['checkout', '-b', name, 'main'], origin);
  }

  it('verifies a squash merge of a multi-commit branch', async () => {
    await multiCommitBranch();
    await squashMergeOnOrigin();

    const r = await landDelivery(config, project(), ticket(), BRANCH);
    expect(r).toMatchObject({ mode: 'pr', landed: true });
    expect(r.detail).toMatch(/identical trees|squash commit/);
  });

  it('verifies a squash merge after unrelated commits landed on the default branch', async () => {
    await multiCommitBranch();
    await squashMergeOnOrigin();
    await commit(origin, 'later.ts', 'export const later = true;\n', 'chore: something else');

    const r = await landDelivery(config, project(), ticket(), BRANCH);
    expect(r.landed).toBe(true);
    expect(r.detail).toMatch(/squash commit/);
  });

  it('verifies an ordinary merge that leaves the branch head reachable', async () => {
    await multiCommitBranch();
    const branchHead = await head(clone, BRANCH);
    await git(['checkout', 'main'], origin);
    await git(['fetch', clone, `${BRANCH}:merge-src`], origin);
    await git(['merge', '--no-ff', '-m', 'merge the branch', 'merge-src'], origin);

    const r = await landDelivery(config, project(), ticket(), BRANCH);
    expect(r).toMatchObject({ landed: true, head: branchHead });
    expect(r.detail).toContain('contains the branch head');
  });

  it('verifies commits that were cherry-picked one at a time', async () => {
    await multiCommitBranch();
    await git(['checkout', 'main'], origin);
    // Unrelated work first, so the picked commits get new parents and new shas: ancestry and tree
    // equality both fail and only the per-commit patch-id check can recognise them.
    await commit(origin, 'unrelated.ts', 'export const u = 1;\n', 'chore: unrelated');
    await git(['fetch', clone, `${BRANCH}:pick-src`], origin);
    await git(['cherry-pick', `${await head(origin, 'pick-src')}~3..pick-src`], origin);

    const r = await landDelivery(config, project(), ticket(), BRANCH);
    expect(r.landed).toBe(true);
    expect(r.detail).toContain('every commit of the branch');
  });

  it('refuses a branch whose changes are not on the default branch', async () => {
    await multiCommitBranch();
    await commit(origin, 'other.ts', 'export const other = 1;\n', 'chore: unrelated');

    await expect(landDelivery(config, project(), ticket(), BRANCH)).rejects.toMatchObject({ code: 'merge_unverified' });
  });

  it('fast-forwards the primary clone in local-branch mode', async () => {
    await multiCommitBranch();
    const branchHead = await head(clone, BRANCH);

    const r = await landDelivery(config, project({ policies: { deliveryMode: 'local-branch' } }), ticket(), BRANCH);
    expect(r).toMatchObject({ mode: 'local-branch', landed: true, head: branchHead });
    expect(await head(clone, 'main')).toBe(branchHead);
  });

  it('refuses a local-branch delivery that is not fast-forwardable', async () => {
    await multiCommitBranch();
    await commit(clone, 'diverged.ts', 'export const d = 1;\n', 'chore: diverge main');

    await expect(landDelivery(config, project({ policies: { deliveryMode: 'local-branch' } }), ticket(), BRANCH))
      .rejects.toMatchObject({ code: 'merge_unverified' });
  });

  describe('a project-declared landing branch distinct from the default branch (VS-119)', () => {
    it('verifies a squash merge onto the declared landing branch', async () => {
      await branchOnOrigin('edge');
      await multiCommitBranch();
      await squashMergeOnOrigin('edge');

      const r = await landDelivery(config, project({ landingBranch: 'edge' }), ticket(), BRANCH);
      expect(r).toMatchObject({ mode: 'pr', landed: true });
      expect(r.detail).toContain('origin/edge');
    });

    it("refuses when the branch reached the default branch but not the declared landing branch", async () => {
      await branchOnOrigin('edge');
      await multiCommitBranch();
      await squashMergeOnOrigin('main');

      await expect(landDelivery(config, project({ landingBranch: 'edge' }), ticket(), BRANCH))
        .rejects.toMatchObject({ code: 'merge_unverified', message: expect.stringContaining('origin/edge') });
    });
  });

  describe("a ticket's own landing branch overrides its project's (VS-119)", () => {
    it("verifies against the ticket's own declared landing branch", async () => {
      await branchOnOrigin('edge');
      await multiCommitBranch();
      await squashMergeOnOrigin('main');

      const r = await landDelivery(config, project({ landingBranch: 'edge' }), ticket({ landingBranch: 'main' }), BRANCH);
      expect(r).toMatchObject({ mode: 'pr', landed: true });
      expect(r.detail).toContain('origin/main');
    });

    it("refuses when the branch reached the project's landing branch but not the ticket's own", async () => {
      await branchOnOrigin('edge');
      await multiCommitBranch();
      await squashMergeOnOrigin('edge');

      await expect(landDelivery(config, project({ landingBranch: 'edge' }), ticket({ landingBranch: 'main' }), BRANCH))
        .rejects.toMatchObject({ code: 'merge_unverified', message: expect.stringContaining('origin/main') });
    });
  });
});
