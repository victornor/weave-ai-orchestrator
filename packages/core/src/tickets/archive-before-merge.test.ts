import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { git } from '../util/git.js';
import { archiveOnBranch, attemptArchiveThenMerge, isFreshAgainstLanding, rebaseOntoLanding, resetNoCiStateForTests } from './archive-before-merge.js';
import { SCRATCH_STALE_MS, activeScratchWorktrees, scratchBranchFrom, scratchLandWorktree, scratchRoot, sweepScratchWorktrees, type ScratchTarget } from './scratch.js';

const BRANCH = 'ac/tst-1-dark-mode';

describe('archive-before-merge mechanics', () => {
  let dir: string;
  let origin: string;
  let clone: string;
  let scratchTarget: ScratchTarget;
  let planted: string[];

  const commit = async (repo: string, file: string, body: string, message: string): Promise<void> => {
    writeFileSync(join(repo, file), body);
    await git(['add', '.'], repo);
    await git(['commit', '-m', message], repo);
  };
  const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(['rev-parse', ref], repo)).stdout.trim();

  /** Every registered worktree of the clone whose path is one of ours — must be empty after a landing. */
  const scratchWorktrees = async (): Promise<string[]> => {
    const listed = await git(['worktree', 'list', '--porcelain'], clone);
    return listed.stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length).trim())
      .filter((p) => p.startsWith(scratchRoot(scratchTarget.stateDir)) || /[\\/]ac-land-/.test(p));
  };

  /** A finished landing — any outcome — leaves no scratch worktree registered and no directory holding one. */
  const expectNoScratch = async (): Promise<void> => {
    expect(await scratchWorktrees()).toEqual([]);
    const parent = join(scratchRoot(scratchTarget.stateDir), 'tst');
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([]);
  };

  beforeEach(async () => {
    resetNoCiStateForTests();
    dir = mkdtempSync(join(tmpdir(), 'ac-abm-'));
    origin = join(dir, 'origin');
    clone = join(dir, 'clone');
    scratchTarget = { stateDir: join(dir, 'state'), projectSlug: 'tst', label: 'T-1' };
    planted = [];

    await git(['init', '-b', 'main', origin], dir);
    await git(['config', 'user.email', 'test@example.com'], origin);
    await git(['config', 'user.name', 'Test'], origin);
    await git(['config', 'receive.denyCurrentBranch', 'ignore'], origin);
    await commit(origin, 'README.md', '# api\n', 'init');

    await git(['clone', origin, clone], dir);
    await git(['config', 'user.email', 'test@example.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);
  });
  afterEach(async () => {
    // Never leave a worktree registered or an active entry behind for the next test.
    for (const path of await scratchWorktrees()) await git(['worktree', 'remove', '--force', path], clone).catch(() => {});
    await git(['worktree', 'prune'], clone).catch(() => {});
    for (const path of planted) rmSync(path, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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
      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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

    // VS-408: a new-capability change (`gadgets`) whose delta has no `## Purpose`; archiving it
    // creates a capability spec, so it needs a proposal Why to archive cleanly.
    async function seedGadgetChange(repo: string, changeName: string, why: string | null): Promise<void> {
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
      await git(['commit', '-m', `chore: seed ${changeName}`], repo);
    }

    /** Builds `branch` as the clone's current main plus a real archive commit for `changeName`, and pushes it. */
    async function pushArchiveBranch(branch: string, changeName: string): Promise<void> {
      const scratch = await scratchBranchFrom(clone, 'HEAD', branch, scratchTarget);
      try {
        await archiveOnBranch(scratch.path, changeName);
        const push = await git(['push', 'origin', `HEAD:refs/heads/${branch}`], scratch.path, 120_000);
        expect(push.ok).toBe(true);
      } finally {
        await scratch.dispose();
      }
    }

    /** Main independently adds the `gadgets` spec the archive branch already added, so the rebase conflicts. */
    async function addMainGadgetSpec(): Promise<void> {
      mkdirSync(join(origin, 'openspec', 'specs', 'gadgets'), { recursive: true });
      writeFileSync(
        join(origin, 'openspec', 'specs', 'gadgets', 'spec.md'),
        '# gadgets Specification\n\n## Purpose\nMain already carries gadgets for its own reasons, at least fifty chars.\n\n## Requirements\n\n### Requirement: A gadget is visible\nThe system SHALL show a gadget.\n\n#### Scenario: Visible\n- **WHEN** looked at\n- **THEN** it is visible\n',
      );
      await git(['add', '.'], origin);
      await git(['commit', '-m', 'feat: main gadgets spec'], origin);
    }

    const GADGET_WHY = 'Gadgets exist so callers can rely on a gadget being present and shaped the way this capability guarantees.';

    it('rebuilds a conflicting archive branch from the landing tip (VS-408)', async () => {
      await seedGadgetChange(origin, 'add-gadget', GADGET_WHY);
      await git(['pull', 'origin', 'main'], clone);
      await pushArchiveBranch('ac/archive-add-gadget', 'add-gadget');
      await addMainGadgetSpec();
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: 'ac/archive-add-gadget', landingBranch: 'main', scratch: scratchTarget,
        changeName: 'add-gadget', forge, prUrl: 'https://example.com/pr/313', method: 'squash', rebuildArchiveOnConflict: true,
      });
      expect(outcome).toMatchObject({ kind: 'merged' });

      await git(['fetch', 'origin'], clone);
      const spec = (await git(['show', 'refs/remotes/origin/ac/archive-add-gadget:openspec/specs/gadgets/spec.md'], clone)).stdout;
      expect(spec).toMatch(/A gadget is visible/); // main's requirement kept
      expect(spec).toMatch(/A gadget exists/); // the change's requirement added
      const tree = (await git(['ls-tree', '-r', '--name-only', 'refs/remotes/origin/ac/archive-add-gadget'], clone)).stdout;
      expect(tree).toMatch(/openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-add-gadget\//);
      expect(tree).not.toMatch(/openspec\/changes\/add-gadget\//);
      await expectNoScratch();
    });

    it('still rebases a clean stale archive branch when the rebuild opt is set (VS-408)', async () => {
      await seedGadgetChange(origin, 'add-gadget', GADGET_WHY);
      await git(['pull', 'origin', 'main'], clone);
      await pushArchiveBranch('ac/archive-add-gadget', 'add-gadget');
      await commit(origin, 'later.ts', 'export const later = 1;\n', 'chore: landed first');
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: 'ac/archive-add-gadget', landingBranch: 'main', scratch: scratchTarget,
        changeName: 'add-gadget', forge, prUrl: 'https://example.com/pr/313', method: 'squash', rebuildArchiveOnConflict: true,
      });
      expect(outcome).toMatchObject({ kind: 'merged' });
      await git(['fetch', 'origin'], clone);
      const log = (await git(['log', '--oneline', 'refs/remotes/origin/ac/archive-add-gadget'], clone)).stdout;
      expect(log).toMatch(/landed first/); // the clean rebase replayed main's commit
      const spec = (await git(['show', 'refs/remotes/origin/ac/archive-add-gadget:openspec/specs/gadgets/spec.md'], clone)).stdout;
      expect(spec).toMatch(/A gadget exists/);
    });

    it('does not rebuild a conflicting archive branch when the opt is unset (VS-408)', async () => {
      await seedGadgetChange(origin, 'add-gadget', GADGET_WHY);
      await git(['pull', 'origin', 'main'], clone);
      await pushArchiveBranch('ac/archive-add-gadget', 'add-gadget');
      await addMainGadgetSpec();
      const remoteBefore = (await git(['ls-remote', origin, 'ac/archive-add-gadget'], clone)).stdout;

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: 'ac/archive-add-gadget', landingBranch: 'main', scratch: scratchTarget,
        changeName: 'add-gadget', forge: fakeForge(), prUrl: 'https://example.com/pr/313', method: 'squash',
      });
      expect(outcome.kind).toBe('conflict');
      expect((await git(['ls-remote', origin, 'ac/archive-add-gadget'], clone)).stdout).toBe(remoteBefore);
      await expectNoScratch();
    });

    it('merges immediately when nothing is stale, there is no change, and no checks are configured', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge();

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      expect(forge.mergePr).toHaveBeenCalledWith(clone, 'https://example.com/pr/1', 'squash');
      // Nothing needed pushing, so the branch on origin is unchanged.
      expect((await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim())
        .toBe((await git(['rev-parse', BRANCH], clone)).stdout.trim());
      await expectNoScratch();
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
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: 'add-thing', forge, prUrl: 'https://example.com/pr/1', method: 'squash',
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
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
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
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome.kind).toBe('conflict');
      expect(forge.mergePr).not.toHaveBeenCalled();
      expect((await git(['ls-remote', origin, BRANCH], clone)).stdout).toBe(remoteBefore);
      await expectNoScratch();
    });

    it('reports checks_pending without merging', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'pending' as const })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
      await expectNoScratch();
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
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: 'add-thing', forge: pending, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(first).toEqual({ kind: 'checks_pending' });

      // The worker re-fetches and resets to the remote tip, which already carries the archive
      // commit `attemptArchiveThenMerge` pushed above, then requests landing again.
      const passing = fakeForge();
      const second = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: 'add-thing', forge: passing, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(second).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: expect.stringContaining('add-thing') });
      expect(passing.mergePr).toHaveBeenCalledTimes(1);
    });

    it('reports checks_failed without merging', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({ prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'failure' as const })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      });
      expect(outcome).toEqual({ kind: 'checks_failed' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('brings a draft out of draft before reading checks and never merges a fresh absence (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const order: string[] = [];
      const forge = fakeForge({
        markPullRequestReady: vi.fn(async () => { order.push('ready'); return { changed: true }; }),
        prState: vi.fn(async () => { order.push('checks'); return { state: 'open' as const, ciState: 'none' as const }; }),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(order).toEqual(['ready', 'checks']);
      expect(forge.mergePr).not.toHaveBeenCalled();
      await expectNoScratch();
    });

    it('a rebase push to an already-ready pull request waits on its fresh checks (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      await commit(origin, 'later.ts', 'export const later = 1;\n', 'chore: landed first');
      const forge = fakeForge({
        markPullRequestReady: vi.fn(async () => ({ changed: false })),
        prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('a pre-existing non-draft pull request is unaffected: no push, no draft transition, absent checks merge (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({ markPullRequestReady: vi.fn(async () => ({ changed: false })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      expect(forge.markPullRequestReady).toHaveBeenCalledWith(clone, 'https://example.com/pr/1');
    });

    it('a no-CI project merges a fresh absence when requireCi is false (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      await commit(origin, 'later.ts', 'export const later = 1;\n', 'chore: landed first');
      const forge = fakeForge({ markPullRequestReady: vi.fn(async () => ({ changed: true })) });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash', requiresCi: false,
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
    });

    it('merges on an absent rollup when the repository has no CI workflows (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({
        hasCiWorkflows: vi.fn(async () => false),
        markPullRequestReady: vi.fn(async () => ({ changed: true })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/no-ci', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      expect(forge.hasCiWorkflows).toHaveBeenCalledWith(clone);
    });

    it('waits on an absent rollup when the repository does have CI workflows (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({
        hasCiWorkflows: vi.fn(async () => true),
        markPullRequestReady: vi.fn(async () => ({ changed: true })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/has-ci', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('stops waiting past the grace, merges and reports once, when the forge cannot tell (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const onNoCiTimeout = vi.fn();
      const forge = fakeForge({ markPullRequestReady: vi.fn(async () => ({ changed: true })) }); // no hasCiWorkflows

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/grace', method: 'squash', requiresCi: true, noCiGraceMs: 0, onNoCiTimeout,
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
      expect(onNoCiTimeout).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting within the grace across landing retries (VS-393)', async () => {
      await pushBranchFromClone(BRANCH);
      const onNoCiTimeout = vi.fn();
      const opts = {
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null,
        prUrl: 'https://example.com/pr/retry', method: 'squash', requiresCi: true, noCiGraceMs: 60_000, onNoCiTimeout,
      } as const;

      expect(await attemptArchiveThenMerge({ ...opts, forge: fakeForge({ markPullRequestReady: vi.fn(async () => ({ changed: true })) }) })).toEqual({ kind: 'checks_pending' });
      expect(await attemptArchiveThenMerge({ ...opts, forge: fakeForge({ markPullRequestReady: vi.fn(async () => ({ changed: false })) }) })).toEqual({ kind: 'checks_pending' });
      expect(onNoCiTimeout).not.toHaveBeenCalled();
    });

    // VS-466: the gate used to read an all-skipped rollup as a pass. `rollupState` now reports an
    // all-skipped head as `none`, and the gate refuses any absent rollup on a repository with CI.
    it('rejects an all-skipped head on a CI repository even when nothing changed this attempt (VS-466)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({
        hasCiWorkflows: vi.fn(async () => true),
        markPullRequestReady: vi.fn(async () => ({ changed: false })),
        prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge,
        prUrl: 'https://example.com/pr/all-skipped', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('rejects a success the forge reports for a head other than the one that will land (VS-466)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({
        prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'success' as const, headSha: '0'.repeat(40) })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge,
        prUrl: 'https://example.com/pr/stale-head', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'checks_pending' });
      expect(forge.mergePr).not.toHaveBeenCalled();
    });

    it('accepts a success on the exact head the landing produces (VS-466)', async () => {
      await pushBranchFromClone(BRANCH);
      const forge = fakeForge({
        prState: vi.fn(async () => ({
          state: 'open' as const, ciState: 'success' as const,
          headSha: (await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim(),
        })),
      });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge,
        prUrl: 'https://example.com/pr/exact-head', method: 'squash', requiresCi: true,
      });
      expect(outcome).toEqual({ kind: 'merged', mergeCommit: 'deadbeef', archivedAs: null });
    });

    it('brings the pull request out of draft before pushing the head that will land (VS-466)', async () => {
      await seedGadgetChange(origin, 'add-gadget', GADGET_WHY);
      await git(['pull', 'origin', 'main'], clone);
      await pushBranchFromClone(BRANCH);

      let remoteAtReady: string | null = null;
      const ready = vi.fn(async () => {
        remoteAtReady = (await git(['ls-remote', origin, BRANCH], clone)).stdout.trim().split('\t')[0] ?? null;
        return { changed: true };
      });
      const forge = fakeForge({ markPullRequestReady: ready });

      const outcome = await attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: 'add-gadget', forge,
        prUrl: 'https://example.com/pr/order', method: 'squash',
      });
      expect(outcome).toMatchObject({ kind: 'merged' });

      await git(['fetch', 'origin'], clone);
      const finalTip = (await git(['rev-parse', `refs/remotes/origin/${BRANCH}`], clone)).stdout.trim();
      // The ready transition saw the pre-push tip: the archive commit was pushed only afterwards, so
      // the one push of the sequence is a push to a pull request that is already out of draft.
      expect(remoteAtReady).not.toBeNull();
      expect(remoteAtReady).not.toBe(finalTip);
      expect(ready).toHaveBeenCalledTimes(1);
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

      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
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
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
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

  // VS-383: the scratch worktree lives under the workspace state dir, creation is leak-proof, and a
  // push failure (like every other landing outcome) leaves nothing behind.
  describe('scratch placement and cleanup (VS-383)', () => {
    it('creates the scratch worktree under the state dir, never /tmp', async () => {
      await pushBranchFromClone(BRANCH);
      const scratch = await scratchLandWorktree(clone, BRANCH, scratchTarget);
      try {
        expect(scratch.path.startsWith(join(scratchRoot(scratchTarget.stateDir), 'tst'))).toBe(true);
        expect(scratch.path.startsWith(join(tmpdir(), 'ac-land-'))).toBe(false);
      } finally {
        await scratch.dispose();
      }
      expect(existsSync(scratch.path)).toBe(false);
    });

    it('a failed creation leaves no directory and no registered worktree', async () => {
      await pushBranchFromClone(BRANCH);
      const before = await scratchWorktrees();
      // `-b` on a branch that already exists makes `git worktree add` fail after the directory was made.
      await expect(scratchBranchFrom(clone, 'HEAD', BRANCH, scratchTarget)).rejects.toMatchObject({ code: 'internal' });
      expect(await scratchWorktrees()).toEqual(before);
      await expectNoScratch();
    });

    it('a push failure leaves no scratch directory or registered worktree', async () => {
      await pushBranchFromClone(BRANCH);
      // Move the landing branch after the ticket branch was cut, so the rebase rewrites the branch and
      // the push is non-fast-forward; denyNonFastForwards then rejects it.
      await commit(origin, 'later.ts', 'export const later = 1;\n', 'chore: landed first');
      await git(['config', 'receive.denyNonFastForwards', 'true'], origin);
      const forge: ForgeAdapter = {
        id: 'github',
        detect: async () => true,
        prState: vi.fn(async () => ({ state: 'open' as const, ciState: 'none' as const })),
        mergePr: vi.fn(async () => ({ mergeCommit: 'deadbeef' })),
      };

      await expect(attemptArchiveThenMerge({
        clonePath: clone, branch: BRANCH, landingBranch: 'main', scratch: scratchTarget, changeName: null, forge, prUrl: 'https://example.com/pr/1', method: 'squash',
      })).rejects.toMatchObject({ code: 'internal' });
      expect(forge.mergePr).not.toHaveBeenCalled();
      await expectNoScratch();
    });
  });

  describe('sweepScratchWorktrees (VS-383)', () => {
    const sweep = (opts: { minAgeMs?: number; active?: ReadonlySet<string> } = {}) =>
      sweepScratchWorktrees({ clones: [{ clonePath: clone, slug: 'tst' }], stateDir: scratchTarget.stateDir, ...opts });

    it('removes a planted stale scratch worktree and leaves a worker worktree and a fresh in-flight one alone', async () => {
      await pushBranchFromClone(BRANCH);
      // A worker worktree is never a candidate, however old.
      const worker = join(dir, 'worker-worktree');
      expect((await git(['worktree', 'add', worker, BRANCH], clone)).ok).toBe(true);

      // A planted scratch tree (raw git, so it is not in the in-flight set) with an old mtime.
      const stale = join(scratchRoot(scratchTarget.stateDir), 'tst', 'T-1-stale');
      mkdirSync(join(scratchRoot(scratchTarget.stateDir), 'tst'), { recursive: true });
      expect((await git(['worktree', 'add', '--detach', stale, `origin/${BRANCH}`], clone)).ok).toBe(true);
      const old = new Date(Date.now() - SCRATCH_STALE_MS * 2);
      utimesSync(stale, old, old);

      // A fresh scratch tree created through the API is in flight and must be left alone.
      const fresh = await scratchLandWorktree(clone, BRANCH, scratchTarget);
      expect(activeScratchWorktrees().has(fresh.path)).toBe(true);
      try {
        const result = await sweep({ minAgeMs: 0 });
        expect(result.removed.map((r) => r.path)).toEqual([stale]);
        expect(result.bytes).toBeGreaterThan(0);
        expect(existsSync(stale)).toBe(false);
        expect(existsSync(fresh.path)).toBe(true);
        expect(existsSync(worker)).toBe(true);
        expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], worker)).stdout.trim()).toBe(BRANCH);
      } finally {
        await fresh.dispose();
        await git(['worktree', 'remove', '--force', worker], clone).catch(() => {});
      }
    });

    it('removes a legacy /tmp/ac-land-* directory that belongs to a known clone', async () => {
      await pushBranchFromClone(BRANCH);
      const legacy = mkdtempSync(join(tmpdir(), 'ac-land-'));
      planted.push(legacy);
      expect((await git(['worktree', 'add', '--detach', legacy, `origin/${BRANCH}`], clone)).ok).toBe(true);
      const old = new Date(Date.now() - SCRATCH_STALE_MS * 2);
      utimesSync(legacy, old, old);

      const result = await sweep({ minAgeMs: SCRATCH_STALE_MS });
      expect(result.removed.map((r) => r.path)).toContain(legacy);
      expect(existsSync(legacy)).toBe(false);
    });

    it('leaves a legacy /tmp/ac-land-* directory of another clone alone', async () => {
      await pushBranchFromClone(BRANCH);
      const foreign = mkdtempSync(join(tmpdir(), 'ac-land-'));
      planted.push(foreign);
      // A plain directory with a `.git` file naming a clone that is not in the sweep's list.
      const foreignClone = join(dir, 'foreign-clone');
      mkdirSync(join(foreignClone, '.git', 'worktrees', 'ac-land-x'), { recursive: true });
      writeFileSync(join(foreign, '.git'), `gitdir: ${join(foreignClone, '.git', 'worktrees', 'ac-land-x')}\n`);
      const old = new Date(Date.now() - SCRATCH_STALE_MS * 2);
      utimesSync(foreign, old, old);

      const result = await sweep({ minAgeMs: 0 });
      expect(result.removed.map((r) => r.path)).not.toContain(foreign);
      expect(existsSync(foreign)).toBe(true);
    });
  });
});
