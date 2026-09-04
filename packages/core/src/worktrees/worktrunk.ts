import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorktreeProvider, WorktreeInfo } from '@agent-conductor/plugin-sdk';
import { OcError } from '@agent-conductor/shared';
import { sh } from '../util/exec.js';
import { branchExists, worktreeState } from '../util/git.js';

interface WtListItem {
  branch?: string;
  head?: { sha?: string; short_sha?: string; subject?: string; committed_at?: string };
  worktree?: { path?: string; main?: boolean; current?: boolean; detached?: boolean; branch_mismatch?: boolean; changes?: Record<string, number | { added?: number; deleted?: number }> };
  default_branch?: { ahead?: number; behind?: number; merge_conflicts?: boolean };
}

function dirtyFrom(item: WtListItem): boolean {
  const c = item.worktree?.changes;
  if (!c) return false;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'diff') continue;
    if (typeof v === 'number' && v > 0) return true;
  }
  return false;
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  // wt may print progress lines before the JSON document; take the last balanced object.
  const start = trimmed.indexOf('{');
  if (start >= 0) { try { return JSON.parse(trimmed.slice(start)); } catch { /* give up */ } }
  return null;
}

/** Default provider: the `wt` CLI (worktrunk), always scoped to the workspace's generated config. */
export class WorktrunkProvider implements WorktreeProvider {
  readonly id = 'worktrunk';

  async detect(): Promise<{ available: boolean; version?: string }> {
    const r = await sh('wt', ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
    return { available: r.ok, version: r.stdout.trim().split(/\s+/).pop() };
  }

  private base(repoPath: string, configPath?: string): string[] {
    const args = ['-C', repoPath];
    if (configPath) args.push('--config', configPath);
    return args;
  }

  async create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string; warmPaths?: string[]; configPath?: string }): Promise<WorktreeInfo> {
    mkdirSync(dirname(input.targetPath), { recursive: true });
    // A reopened ticket comes back on its existing branch: switch to it instead of creating it.
    const exists = await branchExists(input.repoPath, input.branch);
    const args = [
      ...this.base(input.repoPath, input.configPath),
      '--config-set', `worktree-path="${input.targetPath}"`,
      '-y', 'switch', ...(exists ? [input.branch] : ['--create', input.branch, '--base', input.base]), '--no-cd', '--format', 'json',
    ];
    const r = await sh('wt', args, { cwd: input.repoPath, timeoutMs: 900_000, env: { NO_COLOR: '1' } });
    const doc = parseJsonLoose(r.stdout) as { action?: string; branch?: string; path?: string; created_branch?: boolean; base_branch?: string } | null;
    const path = doc?.path ?? input.targetPath;
    if (!existsSync(path)) {
      throw new OcError('internal', `wt switch --create did not produce a worktree: ${(r.stderr || r.stdout).trim().slice(0, 500)}`, { branch: input.branch, targetPath: input.targetPath });
    }
    const st = await worktreeState(path, input.base);
    return { path, branch: doc?.branch ?? input.branch, head: st.head ?? undefined, dirty: st.dirty, ahead: st.ahead, behind: st.behind };
  }

  async list(repoPath: string, configPath?: string): Promise<WorktreeInfo[]> {
    const r = await sh('wt', [...this.base(repoPath, configPath), 'list', '--format', 'json', '--no-progressive'], { cwd: repoPath, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    const doc = parseJsonLoose(r.stdout) as { items?: WtListItem[] } | null;
    const items = doc?.items ?? [];
    return items
      .filter((i) => i.worktree?.path)
      .map((i) => ({
        path: i.worktree!.path!,
        branch: i.branch ?? '',
        head: i.head?.sha,
        dirty: dirtyFrom(i),
        ahead: i.default_branch?.ahead ?? 0,
        behind: i.default_branch?.behind ?? 0,
        mergeConflicts: i.default_branch?.merge_conflicts ?? false,
        main: i.worktree?.main ?? false,
      }));
  }

  async remove(input: { repoPath: string; path: string; branch: string; deleteBranch: boolean; force: boolean; configPath?: string }): Promise<void> {
    const args = [...this.base(input.repoPath, input.configPath), 'remove', input.branch, '--foreground', '--format', 'json'];
    if (!input.deleteBranch) args.push('--no-delete-branch');
    if (input.force) args.push('--force');
    const r = await sh('wt', args, { cwd: input.repoPath, timeoutMs: 300_000, env: { NO_COLOR: '1' } });
    // `wt remove` exits 0 even when it refuses (dirty worktree); the path is the only reliable signal.
    if (existsSync(input.path)) {
      throw new OcError('worktree_dirty', `wt remove refused to remove ${input.path}: ${(r.stdout || r.stderr).trim().slice(0, 500)}`, { path: input.path, branch: input.branch });
    }
    // `branch_deleted` in the JSON is unreliable; verify with git and finish the job ourselves.
    if (input.deleteBranch && input.branch && (await branchExists(input.repoPath, input.branch))) {
      await sh('git', ['branch', '-D', input.branch], { cwd: input.repoPath, timeoutMs: 30_000 });
    }
  }
}
