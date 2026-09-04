import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorktreeProvider, WorktreeInfo } from '@openconductor/plugin-sdk';
import { git, resolveBaseRef, branchExists, worktreeState } from '../util/git.js';
import { sh, shell } from '../util/exec.js';
import { OcError } from '@openconductor/shared';

/** Built-in fallback provider: plain `git worktree` plus rsync warm-up and the project's setup command. */
export class GitWorktreeProvider implements WorktreeProvider {
  readonly id = 'git';

  async detect(): Promise<{ available: boolean; version?: string }> {
    const r = await sh('git', ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
    return { available: r.ok, version: r.stdout.trim().replace(/^git version /, '') };
  }

  async create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string; warmPaths?: string[] }): Promise<WorktreeInfo> {
    const { repoPath, branch, base, targetPath } = input;
    mkdirSync(dirname(targetPath), { recursive: true });
    const baseRef = (await resolveBaseRef(repoPath, base)) ?? base;
    const exists = await branchExists(repoPath, branch);
    const args = exists ? ['worktree', 'add', targetPath, branch] : ['worktree', 'add', '-b', branch, targetPath, baseRef];
    const add = await git(args, repoPath, 120_000);
    if (!add.ok) throw new OcError('internal', `git worktree add failed: ${add.stderr.trim() || add.stdout.trim()}`, { branch, targetPath });

    for (const rel of input.warmPaths ?? []) {
      const src = join(repoPath, rel);
      if (!existsSync(src)) continue;
      const dest = join(targetPath, rel);
      mkdirSync(dirname(dest), { recursive: true });
      await sh('rsync', ['-a', '--delete', `${src.replace(/\/$/, '')}/`, `${dest.replace(/\/$/, '')}/`], { cwd: repoPath, timeoutMs: 600_000 });
    }
    if (input.setupCommand && input.setupCommand.trim()) {
      await shell(input.setupCommand, { cwd: targetPath, timeoutMs: 900_000 });
    }
    const st = await worktreeState(targetPath, base);
    return { path: targetPath, branch, head: st.head ?? undefined, dirty: st.dirty, ahead: st.ahead, behind: st.behind };
  }

  async list(repoPath: string): Promise<WorktreeInfo[]> {
    const r = await git(['worktree', 'list', '--porcelain'], repoPath, 30_000);
    if (!r.ok) return [];
    const out: WorktreeInfo[] = [];
    let cur: Partial<WorktreeInfo> & { detached?: boolean } = {};
    const flush = () => { if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? '', head: cur.head, main: out.length === 0 }); cur = {}; };
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('worktree ')) { flush(); cur.path = line.slice('worktree '.length).trim(); }
      else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line.trim() === 'detached') cur.detached = true;
    }
    flush();
    return out;
  }

  async remove(input: { repoPath: string; path: string; branch: string; deleteBranch: boolean; force: boolean }): Promise<void> {
    const args = ['worktree', 'remove'];
    if (input.force) args.push('--force');
    args.push(input.path);
    const r = await git(args, input.repoPath, 120_000);
    if (!r.ok && existsSync(input.path)) {
      throw new OcError('worktree_dirty', `git worktree remove failed: ${r.stderr.trim() || r.stdout.trim()}`, { path: input.path });
    }
    await git(['worktree', 'prune'], input.repoPath, 30_000);
    if (input.deleteBranch && input.branch) {
      const del = await git(['branch', '-D', input.branch], input.repoPath, 30_000);
      if (!del.ok && (await branchExists(input.repoPath, input.branch))) {
        throw new OcError('internal', `branch delete failed: ${del.stderr.trim()}`, { branch: input.branch });
      }
    }
  }
}
