import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { git } from '../util/git.js';
import { archiveOnBranch, attemptArchiveThenMerge, isFreshAgainstLanding, rebaseOntoLanding, scratchLandWorktree } from './archive-before-merge.js';

const BRANCH = 'ac/tst-1-dark-mode';

describe('archive-before-merge mechanics', () => {
  let dir: string;
  let origin: string;
  let clone: string;

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ac-abm-'));
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
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function pushBranchFromClone(name: string): Promise<void> {
    await git(['checkout', '-b', name], clone);
    await commit(clone, 'a.ts', 'export const a = 1;\n', 'feat: a');
    await git(['push', 'origin', name], clone);
    await git(['checkout', 'main'], clone);
  }

  describe('scratchLandWorktree', () => {
    it('detaches at origin/<branch> in a new directory without disturbing the clone', async () => {
      await pushBranchFromClone(BRANCH);
      const cloneHeadBefore = await head(clone, 'main');
      const remoteHead = (await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim();

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        expect(existsSync(scratch.path)).toBe(true);
        expect(scratch.path).not.toBe(clone);
        // Detached at origin/<branch> — no local branch of the ticket's name is created (VS-363).
        const branchInScratch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], scratch.path)).stdout.trim();
        expect(branchInScratch).toBe('HEAD');
        expect(await head(scratch.path)).toBe(remoteHead);
        // The primary clone's own checkout is untouched.
        const cloneBranchAfter = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], clone)).stdout.trim();
        expect(cloneBranchAfter).toBe('main');
        expect(await head(clone, 'main')).toBe(cloneHeadBefore);
      } finally {
        await scratch.dispose();
      }
      expect(existsSync(scratch.path)).toBe(false);
    });

    it('dispose is idempotent', async () => {
      await pushBranchFromClone(BRANCH);
      const scratch = await scratchLandWorktree(clone, BRANCH);
      await scratch.dispose();
      await expect(scratch.dispose()).resolves.toBeUndefined();
    });
  });

  describe('isFreshAgainstLanding', () => {
    it('is true when the branch already contains the landing tip', async () => {
      await pushBranchFromClone(BRANCH);
      await git(['fetch', 'origin'], clone);
      const fresh = await isFreshAgainstLanding(clone, `origin/${BRANCH}`, 'origin/main');
      expect(fresh).toBe(true);
    });

    it('is false once another commit lands on the landing branch after the ticket branch was cut', async () => {
      await pushBranchFromClone(BRANCH);
      await commit(origin, 'other.ts', 'export const other = 1;\n', 'feat: other landed first');
      await git(['fetch', 'origin'], clone);
      const fresh = await isFreshAgainstLanding(clone, `origin/${BRANCH}`, 'origin/main');
      expect(fresh).toBe(false);
    });
  });

  describe('rebaseOntoLanding', () => {
    it('rebases cleanly when nothing conflicts', async () => {
      await pushBranchFromClone(BRANCH);
      await commit(origin, 'other.ts', 'export const other = 1;\n', 'feat: other landed first');
      await git(['fetch', 'origin'], clone);

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        const outcome = await rebaseOntoLanding(scratch.path, 'origin/main');
        expect(outcome.ok).toBe(true);
        const fresh = await isFreshAgainstLanding(scratch.path, 'HEAD', 'origin/main');
        expect(fresh).toBe(true);
        // The ticket's own commit is still present after the rebase.
        const log = (await git(['log', '--oneline'], scratch.path)).stdout;
        expect(log).toMatch(/feat: a/);
      } finally {
        await scratch.dispose();
      }
    });

    it('reports a real conflict and leaves the branch as it started', async () => {
      await pushBranchFromClone(BRANCH);
      // A conflicting change to the same file+line on the landing branch.
      await git(['checkout', 'main'], origin);
      writeFileSync(join(origin, 'a.ts'), 'export const a = 999;\n');
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'feat: conflicting change'], origin);
      await git(['fetch', 'origin'], clone);

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        const before = await head(scratch.path);
        const outcome = await rebaseOntoLanding(scratch.path, 'origin/main');
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.conflict).toBe(true);
        // Aborted cleanly: back to the pre-rebase head, nothing left mid-rebase.
        expect(await head(scratch.path)).toBe(before);
        const status = await git(['status', '--porcelain'], scratch.path);
        expect(status.stdout.trim()).toBe('');
      } finally {
        await scratch.dispose();
      }
    });
  });

  describe('archiveOnBranch', () => {
    async function seedOpenSpecChange(repo: string, changeName: string): Promise<void> {
      const changeDir = join(repo, 'openspec', 'changes', changeName);
      mkdirSync(join(repo, 'openspec', 'specs', 'widgets'), { recursive: true });
      writeFileSync(
        join(repo, 'openspec', 'specs', 'widgets', 'spec.md'),
        '# widgets Specification\n\n## Purpose\nWidgets exist so things can be widget-shaped for testing archive commits.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n',
      );
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- Add a scenario.\n\n## Capabilities\n\n### Modified Capabilities\n- `widgets`: adds a scenario\n');
      mkdirSync(join(changeDir, 'specs', 'widgets'), { recursive: true });
      writeFileSync(
        join(changeDir, 'specs', 'widgets', 'spec.md'),
        '## MODIFIED Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget, and it SHALL be blue.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n\n#### Scenario: The widget is blue\n- **WHEN** the widget is inspected\n- **THEN** it is blue\n',
      );
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Widget\n\n- [x] 1.1 Make it blue\n');
      await git(['add', '.'], repo);
      await git(['commit', '-m', 'chore: seed openspec change'], repo);
    }

    it('archives the change and commits it onto the worktree HEAD, not the landing branch', async () => {
      await seedOpenSpecChange(origin, 'add-blue-widget');
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);
      await git(['fetch', 'origin'], clone);

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        const beforeLog = await git(['log', '--oneline', '-1'], clone);
        const result = await archiveOnBranch(scratch.path, 'add-blue-widget');
        expect(result.archivedAs).toBeTruthy();
        expect(existsSync(join(scratch.path, 'openspec', 'changes', 'add-blue-widget'))).toBe(false);
        // The archived spec content landed on the ticket's branch.
        const spec = (await git(['show', 'HEAD:openspec/specs/widgets/spec.md'], scratch.path)).stdout;
        expect(spec).toMatch(/blue/);
        // The clone's own checkout (still on `main`) is untouched by the archive commit.
        expect((await git(['log', '--oneline', '-1'], clone)).stdout).toBe(beforeLog.stdout);
      } finally {
        await scratch.dispose();
      }
    });

    // A change introducing a capability carries no main spec yet, so archive creates one; with no
    // `## Purpose` in the delta, openspec writes its placeholder (VS-362).
    async function seedNewCapabilityChange(repo: string, changeName: string, why: string | null): Promise<void> {
      const changeDir = join(repo, 'openspec', 'changes', changeName);
      mkdirSync(join(changeDir, 'specs', 'gadgets'), { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      const whySection = why === null ? '' : `## Why\n\n${why}\n\n`;
      writeFileSync(join(changeDir, 'proposal.md'), `${whySection}## What Changes\n- Add a gadget.\n\n## Capabilities\n\n### New Capabilities\n- \`gadgets\`: adds a gadget\n`);
      writeFileSync(
        join(changeDir, 'specs', 'gadgets', 'spec.md'),
        '## ADDED Requirements\n\n### Requirement: A gadget exists\nThe system SHALL have a gadget.\n\n#### Scenario: One gadget\n- **WHEN** asked\n- **THEN** a gadget is returned\n',
      );
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Gadget\n\n- [x] 1.1 Add it\n');
      await git(['add', '.'], repo);
      await git(['commit', '-m', 'chore: seed new-capability change'], repo);
    }

    it('fills a capability the archive created from the proposal Why', async () => {
      const why = 'Gadgets exist so callers can rely on a gadget being present and shaped the way this capability guarantees.';
      await seedNewCapabilityChange(origin, 'add-gadget', why);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);
      await git(['fetch', 'origin'], clone);

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        await archiveOnBranch(scratch.path, 'add-gadget');
        const spec = (await git(['show', 'HEAD:openspec/specs/gadgets/spec.md'], scratch.path)).stdout;
        expect(spec).toContain(why);
        expect(spec).not.toContain('Update Purpose after archive');
      } finally {
        await scratch.dispose();
      }
    });

    it('rejects an archive that would leave a placeholder and commits nothing', async () => {
      await seedNewCapabilityChange(origin, 'add-gadget-no-why', null);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);
      await git(['fetch', 'origin'], clone);

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        const before = await head(scratch.path);
        await expect(archiveOnBranch(scratch.path, 'add-gadget-no-why'))
          .rejects.toMatchObject({ code: 'openspec_archive_blocked' });
        // Nothing was committed: the branch tip is exactly where it started.
        expect(await head(scratch.path)).toBe(before);
      } finally {
        await scratch.dispose();
      }
    });
  });

  describe('attemptArchiveThenMerge', () => {
    function fakeForge(over: Partial<ForgeAdapter> = {}): ForgeAdapter {
      return {
        id: 'github',
        detect: async () => true,
        prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
        mergePr: vi.fn(async () => ({ mergeCommit: 'deadbeef' })),
        ...over,
      };
    }

    it('merges immediately when nothing is stale, there is no change, and no checks are configured', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      expect(forge.mergePr).toHaveBeenCalledWith(clone, 'https://example.com/pr/1', 'squash');
      // Nothing needed pushing, so the branch on origin is unchanged.
      expect((await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim())
        .toBe((await git(['rev-parse', BRANCH], clone)).stdout.trim());
    });

    it('archives onto the branch and pushes the archive before merging', async () => {
      const changeDir = join(origin, 'openspec', 'changes', 'add-thing');
      mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for archive-commit tests, at least fifty characters long.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- Add a scenario.\n\n## Capabilities\n\n### Modified Capabilities\n- `widgets`: adds a scenario\n');
      mkdirSync(join(changeDir, 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(changeDir, 'specs', 'widgets', 'spec.md'), '## MODIFIED Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget, and it SHALL be blue.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n\n#### Scenario: The widget is blue\n- **WHEN** the widget is inspected\n- **THEN** it is blue\n');
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Widget\n\n- [x] 1.1 Make it blue\n');
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'chore: seed openspec change'], origin);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: 'add-thing', forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toMatchObject({ kind: 'merged', mergeCommit: 'deadbeef' });
      expect((outcome as { archivedAs: string | null }).archivedAs).toBeTruthy();
      await git(['fetch', 'origin'], clone);
      const spec = (await git(['show', `refs/remotes/origin/${BRANCH}:openspec/specs/widgets/spec.md`], clone)).stdout;
      expect(spec).toMatch(/blue/);
    });

    it('rebases a stale branch onto the current landing tip before merging', async () => {
      await pushBranchFromClone(BRANCH);
      await commit(origin, 'later.ts', 'export const later = 1;\n', 'chore: landed first');
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      await git(['fetch', 'origin'], clone);
      const log = (await git(['log', '--oneline', `refs/remotes/origin/${BRANCH}`], clone)).stdout;
      expect(log).toMatch(/landed first/);
      expect(log).toMatch(/feat: a/);
    });

    it('reports a conflict without archiving, pushing, or merging', async () => {
      await pushBranchFromClone(BRANCH);
      await git(['checkout', 'main'], origin);
      writeFileSync(join(origin, 'a.ts'), 'export const a = 999;\n');
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'feat: conflicting change'], origin);
      const forge = fakeForge();
      const remoteBefore = (await git(['ls-remote', origin, BRANCH], clone)).stdout;

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome.kind).toBe('conflict');
      expect(forge.mergePr).not.toHaveBeenCalled();
      expect((await git(['ls-remote', origin, BRANCH], clone)).stdout).toBe(remoteBefore);
    });

    it('reports checks_pending without merging', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'pending' as const })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('a retry after checks_pending does not re-archive, and merges once checks pass (VS-327 review, PR #272)', async () => {
      const changeDir = join(origin, 'openspec', 'changes', 'add-thing');
      mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for archive-commit tests, at least fifty characters long.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- Add a scenario.\n\n## Capabilities\n\n### Modified Capabilities\n- `widgets`: adds a scenario\n');
      mkdirSync(join(changeDir, 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(changeDir, 'specs', 'widgets', 'spec.md'), '## MODIFIED Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget, and it SHALL be blue.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n\n#### Scenario: The widget is blue\n- **WHEN** the widget is inspected\n- **THEN** it is blue\n');
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Widget\n\n- [x] 1.1 Make it blue\n');
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'chore: seed openspec change'], origin);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);

      const pending = fakeForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'pending' as const })) });
      const first = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: 'add-thing', forge: pending, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(first).toEqual({ kind: 'checks_pending' });

      // The worker re-fetches and resets to the remote tip, which already carries the archive
      // commit `attemptArchiveThenMerge` pushed above, then requests landing again.
      const passing = fakeForge();
      const second = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: 'add-thing', forge: passing, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(second).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: expect.stringContaining('add-thing') });
      expect(passing.mergePr).toHaveBeenCalledTimes(1);
    });

    it('reports checks_failed without merging', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'failure' as const })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'checks_failed' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('lands while the worker worktree holds the branch, leaving it untouched (VS-363)', async () => {
      const changeName = 'add-thing';
      const changeDir = join(origin, 'openspec', 'changes', changeName);
      mkdirSync(join(origin, 'openspec', 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(origin, 'openspec', 'specs', 'widgets', 'spec.md'), '# widgets Specification\n\n## Purpose\nWidgets exist for archive-commit tests, at least fifty characters long.\n\n## Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');
      writeFileSync(join(changeDir, 'proposal.md'), '## Why\nTest.\n\n## What Changes\n- Add a scenario.\n\n## Capabilities\n\n### Modified Capabilities\n- `widgets`: adds a scenario\n');
      mkdirSync(join(changeDir, 'specs', 'widgets'), { recursive: true });
      writeFileSync(join(changeDir, 'specs', 'widgets', 'spec.md'), '## MODIFIED Requirements\n\n### Requirement: A widget exists\nThe system SHALL have a widget, and it SHALL be blue.\n\n#### Scenario: One widget\n- **WHEN** asked\n- **THEN** a widget is returned\n\n#### Scenario: The widget is blue\n- **WHEN** the widget is inspected\n- **THEN** it is blue\n');
      writeFileSync(join(changeDir, 'tasks.md'), '## 1. Widget\n\n- [x] 1.1 Make it blue\n');
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'chore: seed openspec change'], origin);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);

      // Stand in for the requesting worker's worktree: a second worktree of the same repository
      // that has the ticket's branch checked out. Before VS-363, scratchLandWorktree's
      // `git checkout -B` refused here with "already used by worktree".
      const workerDir = join(dir, 'worker-worktree');
      const addWorker = await git(['worktree', 'add', workerDir, BRANCH], clone, 60_000);
      expect(addWorker.ok).toBe(true);
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], workerDir)).stdout.trim()).toBe(BRANCH);
      const workerHeadBefore = await head(workerDir);
      const branchesBefore = (await git(['branch', '--format=%(refname:short)'], clone)).stdout.trim().split('\n').sort();

      const scratch = await scratchLandWorktree(clone, BRANCH);
      try {
        // Detached at origin/<branch> — no local branch is created or checked out.
        expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], scratch.path)).stdout.trim()).toBe('HEAD');
        expect(await head(scratch.path)).toBe((await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim());
      } finally {
        await scratch.dispose();
      }
      expect(existsSync(scratch.path)).toBe(false);

      const forge = fakeForge();
      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', changeName, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toMatchObject({ kind: 'merged', mergeCommit: 'deadbeef' });

      // The archive commit landed on the remote branch, and the merge proceeded.
      await git(['fetch', 'origin'], clone);
      const spec = (await git(['show', `refs/remotes/origin/${BRANCH}:openspec/specs/widgets/spec.md`], clone)).stdout;
      expect(spec).toMatch(/blue/);

      // The worker's worktree is untouched: same branch, same HEAD, clean working tree.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], workerDir)).stdout.trim()).toBe(BRANCH);
      expect(await head(workerDir)).toBe(workerHeadBefore);
      expect((await git(['status', '--porcelain'], workerDir)).stdout.trim()).toBe('');

      // No local branch was created or reset, and dispose left no stray scratch branch.
      const branchesAfter = (await git(['branch', '--format=%(refname:short)'], clone)).stdout.trim().split('\n').sort();
      expect(branchesAfter).toEqual(branchesBefore);
    });
  });
});
