/**
 * Host tool detection (PLAN §20 `weave doctor`). The daemon reports these on `/api/health` so a
 * remote `weave doctor` can tell what is missing on the daemon host rather than on the laptop.
 *
 * VS-318: a daemon under systemd or launchd starts before the user's session publishes its `PATH`,
 * so the inherited `PATH` is not the source of truth. `ensureHostToolPath` asks the daemon user's
 * own login shell what its `PATH` is and merges it into the process `PATH` before anything spawns;
 * `startHostToolProbe` keeps the detection snapshot fresh so an unavailable tool can be surfaced
 * without anyone asking `/api/health`.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { getLogger } from '../logger.js';
import { sh } from '../util/exec.js';
import { openspecBin } from '../openspec/cli.js';

const log = getLogger('daemon');

export const HOST_TOOL_IDS = ['git', 'gh', 'openspec', 'wt'] as const;
export type HostToolId = (typeof HOST_TOOL_IDS)[number];

export interface HostTool {
  id: HostToolId;
  available: boolean;
  version: string | null;
  /** The absolute path the tool resolved to, or null when it was not found. */
  path: string | null;
  /** What breaks without it. */
  need: 'required' | 'recommended';
  purpose: string;
}

const SPEC: Record<HostToolId, { bin: () => string; args: string[]; need: HostTool['need']; purpose: string }> = {
  git: { bin: () => 'git', args: ['--version'], need: 'required', purpose: 'clones, worktrees, merges' },
  gh: { bin: () => 'gh', args: ['--version'], need: 'recommended', purpose: 'pull-request delivery (deliveryMode: pr)' },
  openspec: { bin: () => openspecBin(), args: ['--version'], need: 'recommended', purpose: 'change tickets: proposal validation, apply, archive, Spec Explorer' },
  wt: { bin: () => 'wt', args: ['--version'], need: 'recommended', purpose: 'worktrunk worktrees (falls back to plain git worktree)' },
};

/** The absolute path `cmd` resolves to on `pathValue`, or null. Mirrors how a shell would find it. */
export function resolveOnPath(cmd: string, pathValue: string = process.env['PATH'] ?? ''): string | null {
  const dirs = cmd.includes('/') ? [''] : pathValue.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const p = dir ? join(dir, cmd) : cmd;
    try { accessSync(p, constants.X_OK); return p; } catch { /* keep scanning */ }
  }
  return null;
}

export async function detectHostTool(id: HostToolId): Promise<HostTool> {
  const spec = SPEC[id];
  const bin = spec.bin();
  const r = await sh(bin, spec.args, { cwd: process.cwd(), timeoutMs: 10_000, env: { NO_COLOR: '1' } });
  const first = r.stdout.trim().split('\n')[0]?.trim() ?? '';
  const version = r.ok ? (first.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? first) : null;
  return { id, available: r.ok, version, path: r.ok ? resolveOnPath(bin) : null, need: spec.need, purpose: spec.purpose };
}

/**
 * The last completed detection, for callers that cannot await. Set by every `detectHostTools` run,
 * so the briefing and the daemon notice read the most recent probe rather than probing themselves.
 */
let snapshot: Record<HostToolId, HostTool> | null = null;

export function hostToolsSnapshot(): Record<HostToolId, HostTool> | null { return snapshot; }

/** Warning lines for required/recommended tools that are unavailable, read synchronously. */
export function hostToolWarnings(): string[] {
  if (!snapshot) return [];
  const path = process.env['PATH'] ?? '';
  return HOST_TOOL_IDS
    .map((id) => snapshot![id])
    .filter((t) => !t.available)
    .map((t) => `the ${t.id} host tool (${t.need}) was not found on the daemon's PATH: ${path}`);
}

export async function detectHostTools(): Promise<Record<HostToolId, HostTool>> {
  const entries = await Promise.all(HOST_TOOL_IDS.map(async (id) => [id, await detectHostTool(id)] as const));
  const value = Object.fromEntries(entries) as Record<HostToolId, HostTool>;
  snapshot = value;
  return value;
}

let cached: { at: number; value: Record<HostToolId, HostTool> } | null = null;

/** Detection cached for a minute: `/api/health` is polled, and spawning four processes per poll is silly. */
export async function detectHostToolsCached(maxAgeMs = 60_000): Promise<Record<HostToolId, HostTool>> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
  const value = await detectHostTools();
  cached = { at: Date.now(), value };
  return value;
}

/** Drop the detection cache so the next read re-probes (after the setting changes). */
export function clearHostToolCache(): void { cached = null; }

/** One probe now, then on an interval, so unavailability is visible with no `/api/health` request. */
export function startHostToolProbe(intervalMs = 60_000): { stop(): void } {
  const tick = (): void => { void detectHostTools().catch(() => undefined); };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

// ---------- the daemon user's own PATH ----------

export const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const SENTINEL_START = '__weave_login_path_start__';
const SENTINEL_END = '__weave_login_path_end__';

export interface LoginShellOptions {
  /** The shell to run; defaults to `$SHELL`, then the account's shell, then `/bin/sh`. */
  shell?: string | null;
  /** Environment to read `$SHELL` from; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Account-shell fallback; defaults to `os.userInfo().shell`. Injectable for tests. */
  accountShell?: string | null;
  timeoutMs?: number;
}

/** `$SHELL` -> the account's shell -> `/bin/sh`. `$SHELL` is not guaranteed under a service manager. */
export function shellFor(opts: LoginShellOptions = {}): string {
  const env = opts.env ?? process.env;
  const account = opts.accountShell === undefined ? accountShellPath() : opts.accountShell;
  for (const c of [opts.shell, env['SHELL'], account]) if (typeof c === 'string' && c.trim().length) return c.trim();
  return '/bin/sh';
}

function accountShellPath(): string | null {
  try { return userInfo().shell || null; } catch { return null; }
}

/** Pull the sentinel-delimited `PATH` out of a login shell's stdout, ignoring rc banners. */
export function extractLoginPath(stdout: string): string | null {
  const start = stdout.indexOf(SENTINEL_START);
  if (start < 0) return null;
  const end = stdout.indexOf(SENTINEL_END, start + SENTINEL_START.length);
  if (end < 0) return null;
  const value = stdout.slice(start + SENTINEL_START.length, end);
  return value.length ? value : null;
}

/**
 * The daemon user's login-shell `PATH`. Runs the shell as a login *and interactive* shell — the
 * interactive rc is what activates a tool manager — with stdin closed and a bounded timeout, and
 * reads the sentinel-delimited value from stdout only. Null when the shell fails, times out or
 * reports nothing.
 */
export async function loginShellPath(opts: LoginShellOptions = {}): Promise<string | null> {
  const shell = shellFor(opts);
  const script = `printf '%s' '${SENTINEL_START}'; printenv PATH; printf '%s' '${SENTINEL_END}'`;
  const stdout = await runShell(shell, ['-l', '-i', '-c', script], opts.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS);
  return stdout === null ? null : extractLoginPath(stdout);
}

/** Run the shell with stdin ignored and stdout captured, bounded by a timeout. Null on failure. */
function runShell(shell: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, args, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TERM: 'dumb' } });
    } catch { finish(null); return; }
    timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } finish(null); }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { out += chunk; });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out : null));
  });
}

export interface AssembleHostPathInput {
  configured?: readonly string[];
  loginShell?: string | null;
  inherited?: string;
  /** Called for each non-absolute entry dropped, so the daemon can say what it ignored. */
  onDrop?: (dir: string) => void;
}

/**
 * Configured directories first, then the login-shell entries, then the inherited entries; each
 * directory added at most once. Only absolute directories are kept: a relative entry would be a
 * code-execution path (a repository can ship `node_modules/.bin`, and every worker CLI runs with its
 * cwd inside a clone), so `.`, `bin` and `./node_modules/.bin` are dropped from every source. Pure,
 * so the ordering and the filter are testable without touching `process.env`.
 */
export function assembleHostPath(input: AssembleHostPathInput): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string): void => {
    const d = dir.trim();
    if (!d) return;
    if (!isAbsolute(d)) { input.onDrop?.(d); return; }
    if (seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };
  for (const d of input.configured ?? []) add(d);
  for (const d of splitPath(input.loginShell ?? '')) add(d);
  for (const d of splitPath(input.inherited ?? '')) add(d);
  return out.join(delimiter);
}

function splitPath(value: string): string[] { return value.split(delimiter).map((p) => p.trim()).filter(Boolean); }

/**
 * The daemon's own `PATH` before this module ever changed it. Every reassembly starts from this, not
 * from the current process `PATH`, so removing a configured directory from the setting actually
 * removes it instead of inheriting the previous merge. Captured on first use (the startup call).
 */
let baselinePath: string | null = null;

/**
 * Merge the daemon user's login-shell `PATH` (and any configured directories) into the process
 * `PATH`. Called once at daemon startup, before any workspace loads or host tool spawns; every
 * child inherits the assembled value. Relative entries are dropped and logged.
 */
export async function ensureHostToolPath(
  configured: readonly string[] = [],
  opts: LoginShellOptions & { inherited?: string } = {},
): Promise<string> {
  if (baselinePath === null) baselinePath = process.env['PATH'] ?? '';
  const inherited = opts.inherited ?? baselinePath;
  const loginShell = await loginShellPath(opts);
  const assembled = assembleHostPath({
    configured,
    loginShell,
    inherited,
    onDrop: (dir) => log.warn({ dropped: dir }, 'ignoring a non-absolute host tool PATH entry'),
  });
  process.env['PATH'] = assembled;
  return assembled;
}
