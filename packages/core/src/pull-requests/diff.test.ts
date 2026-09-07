import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from '../util/git.js';
import { computeCloneDiff, DIFF_GIT_SUBCOMMANDS, readFileAtRef } from './diff.js';

/** Every git subcommand a mutating or network operation could hide behind. None of these may ever appear in an argv this module builds. */
const FORBIDDEN_VERBS = ['fetch', 'pull', 'push', 'clone', 'remote', 'checkout', 'reset', 'commit', 'branch', 'worktree', 'gc', 'config', 'rebase', 'merge', 'stash', 'tag', 'submodule', 'update-ref', 'symbolic-ref', 'init', 'apply', 'cherry-pick', 'am', 'reflog', 'prune', 'filter-branch'];

describe('pull-requests diff: the git allowlist', () => {
  it('only ever runs read-only subcommands', () => {
    const argvsThisModuleCanBuild = [
      ['diff', '--no-color', 'main...ac/vs-1', '--'],
      ['show', 'main:src/a.ts'],
    ];
    for (const argv of argvsThisModuleCanBuild) {
      expect(DIFF_GIT_SUBCOMMANDS).toContain(argv[0]);
      for (const verb of FORBIDDEN_VERBS) expect(argv).not.toContain(verb);
    }
  });
});

async function initRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}
async function commitFile(dir: string, name: string, content: string, message: string): Promise<void> {
  writeFileSync(`${dir}/${name}`, content, 'utf8');
  await git(['add', '.'], dir);
  await git(['commit', '-m', message], dir);
}

describe('computeCloneDiff', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-clonediff-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('diffs a worker branch against main with no network and no gh', async () => {
    await initRepo(dir);
    await commitFile(dir, 'a.ts', 'line one\nline two\n', 'first');
    await git(['checkout', '-b', 'ac/vs-1'], dir);
    await commitFile(dir, 'a.ts', 'line one\nline two changed\n', 'VS-1: change a line');
    await git(['checkout', 'main'], dir);

    const text = await computeCloneDiff(dir, 'main', 'ac/vs-1');
    expect(text).toContain('diff --git a/a.ts b/a.ts');
    expect(text).toContain('-line two');
    expect(text).toContain('+line two changed');
  });

  it('throws when a ref does not exist', async () => {
    await initRepo(dir);
    await commitFile(dir, 'a.ts', 'x\n', 'first');
    await expect(computeCloneDiff(dir, 'main', 'no-such-branch')).rejects.toThrow(/git diff failed/);
  });
});

describe('readFileAtRef', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-clonediff-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a file at a revision, split into lines', async () => {
    await initRepo(dir);
    await commitFile(dir, 'a.ts', 'one\ntwo\nthree\n', 'first');
    const lines = await readFileAtRef(dir, 'main', 'a.ts');
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('answers null for a file that does not exist at that revision', async () => {
    await initRepo(dir);
    await commitFile(dir, 'a.ts', 'one\n', 'first');
    const lines = await readFileAtRef(dir, 'main', 'never-existed.ts');
    expect(lines).toBeNull();
  });
});
