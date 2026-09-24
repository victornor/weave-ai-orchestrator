import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitCommonDir, sandboxWritableRoots } from '../src/gitdir.js';

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-gitdir-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('gitCommonDir', () => {
  it('returns the .git directory of a primary clone', () => {
    const clone = scratch();
    mkdirSync(join(clone, '.git'));
    expect(gitCommonDir(clone)).toBe(join(clone, '.git'));
  });

  it('resolves a linked worktree through its gitdir and commondir', () => {
    const clone = scratch();
    const gitdir = join(clone, '.git', 'worktrees', 'work');
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, 'commondir'), '../..\n');
    const worktree = join(clone, 'work');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    expect(gitCommonDir(worktree)).toBe(resolve(clone, '.git'));
  });

  it('falls back to the worktrees parent when commondir is absent', () => {
    const clone = scratch();
    const gitdir = join(clone, '.git', 'worktrees', 'work');
    mkdirSync(gitdir, { recursive: true });
    const worktree = join(clone, 'work');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    expect(gitCommonDir(worktree)).toBe(resolve(clone, '.git'));
  });

  it('returns null when there is no .git', () => {
    expect(gitCommonDir(scratch())).toBeNull();
  });

  it('returns null for a malformed .git file', () => {
    const dir = scratch();
    writeFileSync(join(dir, '.git'), 'not a gitdir line\n');
    expect(gitCommonDir(dir)).toBeNull();
  });
});

describe('sandboxWritableRoots', () => {
  it('is empty without a worktree', () => {
    expect(sandboxWritableRoots(null, '/home/w')).toEqual([]);
    expect(sandboxWritableRoots(undefined, '/home/w')).toEqual([]);
  });

  it('adds only the git common dir when the checkout is inside cwd', () => {
    const home = scratch();
    const clone = join(home, 'clone');
    const gitdir = join(clone, '.git', 'worktrees', 'work');
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, 'commondir'), '../..\n');
    const worktree = join(home, 'work');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    expect(sandboxWritableRoots(worktree, home)).toEqual([join(clone, '.git')]);
  });

  it('adds the checkout too when it lies outside cwd', () => {
    const home = scratch();
    const clone = join(scratch(), 'clone');
    mkdirSync(join(clone, '.git'), { recursive: true });
    expect(sandboxWritableRoots(clone, home)).toEqual([clone, join(clone, '.git')]);
  });

  it('skips a checkout that does not exist and has no resolvable .git', () => {
    const home = scratch();
    expect(sandboxWritableRoots(join(home, 'gone'), home)).toEqual([]);
  });
});
