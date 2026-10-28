import { sh, type ExecResult, type OnLine } from './exec.js';
import { OcError } from '@weave-ai/shared';

/** `input` feeds a command that reads stdin, such as `git patch-id`; `onLine` mirrors its output live. */
export async function git(args: string[], cwd: string, timeoutMs = 60_000, input?: string, onLine?: OnLine): Promise<ExecResult> {
  return sh('git', args, { cwd, timeoutMs, env: { GIT_TERMINAL_PROMPT: '0' }, input, onLine });
}

/**
 * Transport-level signals a retry can plausibly outlive (VS-717): a connect timeout, a reset
 * connection, a DNS failure. Deliberately does not match a bare "Could not read from remote
 * repository" or "Permission denied" — those also print on an auth failure, which a retry can never
 * fix, and misclassifying it as transient would just delay the same park.
 */
const TRANSIENT_GIT_FETCH_PATTERNS: RegExp[] = [
  /connection timed out/i,
  /operation timed out/i,
  /connection reset by peer/i,
  /could not resolve host/i,
  /could not resolve hostname/i,
  /temporary failure in name resolution/i,
  /network is unreachable/i,
  /connection refused/i,
  /the remote end hung up unexpectedly/i,
  /kex_exchange_identification/i,
];

/** Whether a `git fetch origin` failure's stderr looks like a transient network/transport fault. */
export function isTransientGitFetchError(stderr: string): boolean {
  return TRANSIENT_GIT_FETCH_PATTERNS.some((re) => re.test(stderr));
}

export interface FetchOriginAttempt { attempt: number; attempts: number; stderr: string; willRetry: boolean }

export interface FetchOriginRetryOptions {
  /** Total attempts, including the first. Defaults to `delaysMs.length + 1`. */
  attempts?: number;
  /** Backoff between attempts, in order; the last value repeats if `attempts` exceeds its length. */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (info: FetchOriginAttempt) => void;
  /** Overridable for tests: the fetch call itself, defaulting to a real `git fetch origin`. */
  run?: (cwd: string, timeoutMs: number) => Promise<ExecResult>;
}

export interface FetchOriginRetryResult { result: ExecResult; attempts: number }

/**
 * `git fetch origin`, retried with backoff when the failure looks transient (VS-717) — a connect
 * timeout, a reset connection, a DNS failure — rather than failing on the first hiccup. A
 * non-transient failure (auth, missing repository) returns immediately, with no retry.
 */
export async function fetchOriginWithRetry(cwd: string, timeoutMs = 300_000, opts: FetchOriginRetryOptions = {}): Promise<FetchOriginRetryResult> {
  const delays = opts.delaysMs ?? [30_000, 90_000];
  const maxAttempts = opts.attempts ?? delays.length + 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const run = opts.run ?? ((c: string, t: number) => git(['fetch', 'origin'], c, t));
  let result: ExecResult;
  let attempt = 0;
  for (;;) {
    attempt++;
    result = await run(cwd, timeoutMs);
    if (result.ok) return { result, attempts: attempt };
    const willRetry = attempt < maxAttempts && isTransientGitFetchError(result.stderr);
    opts.onAttempt?.({ attempt, attempts: maxAttempts, stderr: result.stderr.trim().slice(0, 300), willRetry });
    if (!willRetry) return { result, attempts: attempt };
    await sleep(delays[attempt - 1] ?? delays[delays.length - 1] ?? 0);
  }
}

export interface GitIdentity { name: string; email: string }
export type GitIdentityKey = 'user.name' | 'user.email';
export interface GitIdentityResolution { identity: GitIdentity | null; missing: GitIdentityKey[] }

/** Reads the identity Git would use in `cwd`, including its normal config precedence. */
export async function readGitIdentity(cwd: string): Promise<GitIdentityResolution> {
  const values = new Map<GitIdentityKey, string>();
  for (const key of ['user.name', 'user.email'] as const) {
    const result = await git(['config', '--get', key], cwd, 15_000);
    const value = result.ok ? result.stdout.trim() : '';
    if (value) values.set(key, value);
  }
  const missing = (['user.name', 'user.email'] as const).filter((key) => !values.has(key));
  return {
    identity: missing.length === 0 ? { name: values.get('user.name')!, email: values.get('user.email')! } : null,
    missing,
  };
}

/**
 * VS-874: the identity an agent commits as when neither the project nor the workspace configures
 * one. A GitHub noreply address that links to an account needs the numeric id, which a clone URL
 * does not carry; rather than promise attribution it cannot compute, the default is one generic,
 * publishable bot address for every remote.
 */
export const DEFAULT_WORKER_GIT_IDENTITY: GitIdentity = { name: 'Weave AI', email: 'weave-ai@users.noreply.github.com' };

/**
 * VS-874: whether an address is plausibly a person's rather than a forge/bot noreply. Deliberately
 * broad — one false positive costs an informational line, a false negative publishes a private
 * address. Both GitHub noreply forms end in `users.noreply.github.com`.
 */
export function looksPersonalGitEmail(email: string): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (domain === 'users.noreply.github.com') return false;
  if (local === 'noreply' || local === 'no-reply') return false;
  return true;
}

export type WorkerGitIdentitySource = 'project' | 'workspace' | 'default';
export interface ResolvedWorkerGitIdentity { identity: GitIdentity; source: WorkerGitIdentitySource }

/**
 * VS-874: decides what an agent commits as. It never reads the repository's identity: a project's
 * explicit value wins, then the workspace default, then the generic non-personal default.
 */
export function resolveWorkerGitIdentity(input: { project?: GitIdentity | null; workspace?: GitIdentity | null }): ResolvedWorkerGitIdentity {
  if (input.project) return { identity: input.project, source: 'project' };
  if (input.workspace) return { identity: input.workspace, source: 'workspace' };
  return { identity: DEFAULT_WORKER_GIT_IDENTITY, source: 'default' };
}

/** Stores the source repo's identity in the linked worktree config, independent of HOME. */
export async function configureGitWorktreeIdentity(repoPath: string, worktreePath: string, identity: GitIdentity): Promise<void> {
  const enable = await git(['config', 'extensions.worktreeConfig', 'true'], repoPath, 15_000);
  if (!enable.ok) {
    throw new OcError('validation', `Could not enable Git worktree config for ${repoPath}: ${enable.stderr.trim() || 'git config failed'}`);
  }
  for (const [key, value] of [['user.name', identity.name], ['user.email', identity.email] ] as const) {
    const result = await git(['config', '--worktree', key, value], worktreePath, 15_000);
    if (!result.ok) {
      throw new OcError('validation', `Could not configure ${key} in worker worktree ${worktreePath}: ${result.stderr.trim() || 'git config failed'}`);
    }
  }
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

/** Whether two source strings name the same repository. */
function sameRepo(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/**
 * VS-830: do these two strings name the same repository? GitHub remotes are compared through
 * `githubSshRemote`, so `git@github.com:o/r.git` and `https://github.com/o/r` are the same. Anything
 * else — a local path, another host — is compared as written, ignoring case and a trailing slash.
 * Used to ask whether a release source names a project's previous URL without knowing which form
 * each was written in.
 */
export function sameRepoUrl(a: string, b: string): boolean {
  const norm = (s: string): string => {
    const trimmed = s.trim();
    const gh = githubSshRemote(trimmed);
    if (gh !== trimmed) return gh;
    return trimmed.replace(/\/+$/, '');
  };
  return sameRepo(norm(a), norm(b));
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
