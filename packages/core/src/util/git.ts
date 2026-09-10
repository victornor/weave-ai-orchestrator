import { sh, type ExecResult, type OnLine } from './exec.js';

/** `input` feeds a command that reads stdin, such as `git patch-id`; `onLine` mirrors its output live. */
export async function git(args: string[], cwd: string, timeoutMs = 60_000, input?: string, onLine?: OnLine): Promise<ExecResult> {
  return sh('git', args, { cwd, timeoutMs, env: { GIT_TERMINAL_PROMPT: '0' }, input, onLine });
}

export interface WorktreeState { exists: boolean; dirty: boolean; changedFiles: number; branch: string | null; ahead: number; behind: number; head: string | null }

/** Cheap worktree state for prompts and reports. Never mutates anything. */
export async function worktreeState(path: string, defaultBranch: string): Promise<WorktreeState> {
  const head = await git(['rev-parse', 'HEAD'], path, 15_000);
  if (!head.ok) return { exists: false, dirty: false, changedFiles: 0, branch: null, ahead: 0, behind: 0, head: null };
  const status = await git(['status', '--porcelain'], path, 20_000);
  const lines = status.stdout.split('\n').filter((l) => l.trim().length > 0);
  const br = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path, 15_000);
  const base = await resolveBaseRef(path, defaultBranch);
  let ahead = 0; let behind = 0;
  if (base) {
    const counts = await git(['rev-list', '--left-right', '--count', `${base}...HEAD`], path, 20_000);
    if (counts.ok) {
      const [b, a] = counts.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
      behind = b ?? 0; ahead = a ?? 0;
    }
  }
  return { exists: true, dirty: lines.length > 0, changedFiles: lines.length, branch: br.ok ? br.stdout.trim() : null, ahead, behind, head: head.stdout.trim() };
}

/** origin/<default> when it exists, else the local default branch, else null. */
export async function resolveBaseRef(cwd: string, defaultBranch: string): Promise<string | null> {
  const remote = await git(['rev-parse', '--verify', '--quiet', `origin/${defaultBranch}`], cwd, 15_000);
  if (remote.ok && remote.stdout.trim()) return `origin/${defaultBranch}`;
  const local = await git(['rev-parse', '--verify', '--quiet', defaultBranch], cwd, 15_000);
  if (local.ok && local.stdout.trim()) return defaultBranch;
  return null;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const r = await git(['branch', '--list', branch], cwd, 15_000);
  return r.ok && r.stdout.trim().length > 0;
}

/**
 * GitHub `owner/repo` remotes as `git@github.com:owner/repo.git` so workers can push with SSH
 * (VS-183). Non-GitHub URLs, extra path segments, and local paths are returned trimmed, unchanged.
 */
export function githubSshRemote(url: string): string {
  const raw = url.trim();
  const parsed = githubOwnerRepo(raw);
  if (!parsed) return raw;
  return `git@github.com:${parsed.owner}/${parsed.repo}.git`;
}

function githubOwnerRepo(raw: string): { owner: string; repo: string } | null {
  let host: string | undefined;
  let path: string | undefined;
  const scp = raw.match(/^([^@/\s]+)@([^:]+):(.+)$/);
  if (scp) {
    host = scp[2];
    path = scp[3];
  } else {
    let s = raw;
    if (!/^[a-z+]+:\/\//i.test(s) && /^github\.com\//i.test(s)) s = `https://${s}`;
    try {
      const u = new URL(s);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  if (!host || host.toLowerCase() !== 'github.com') return null;
  const segments = (path ?? '').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** `<host>/<owner>/<repo>` identifier used by worktrunk's per-project config blocks. */
export function projectKeyFromUrl(url: string): string {
  let s = url.trim();
  const scp = s.match(/^([^@/]+)@([^:]+):(.+)$/);
  if (scp) s = `https://${scp[2]}/${scp[3]}`;
  s = s.replace(/^ssh:\/\//, 'https://').replace(/\.git$/, '');
  try {
    const u = new URL(s);
    return `${u.host}${u.pathname}`.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  } catch {
    const clean = s.replace(/^\/+/, '').replace(/\/+$/, '');
    const parts = clean.split('/').filter(Boolean);
    const tail = parts.slice(-2).join('/');
    return `local/${tail || clean || 'repo'}`;
  }
}
