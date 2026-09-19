/**
 * VS-579: worker memory containment. A worker turn's process tree is moved into its own transient
 * systemd scope so an out-of-memory kill takes the worker, not the daemon and every peer. This
 * module builds the `systemd-run` wrapper and the small reads used to attribute a kill; it spawns
 * nothing itself, so it is safe to unit-test.
 *
 * Where no systemd user manager is reachable the caller spawns exactly as before.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { whichSync } from './fsutil.js';

/** A worker turn's containment parameters: the run it belongs to and the memory limit in MB. */
export interface ContainmentRequest {
  runId: string;
  memoryMb: number;
}

export interface ContainmentPrefix {
  cmd: string;
  args: string[];
}

export interface ContainmentEnvironment {
  platform?: NodeJS.Platform;
  /** The user manager's runtime dir; `systemd/private` is its control socket. */
  runtimeDir?: string | null;
  /** Does `systemd-run` resolve on PATH? Injected in tests. */
  hasSystemdRun?: boolean;
  /** Does the user manager's control socket exist? Injected in tests. */
  hasUserManager?: boolean;
}

export const WORKER_SLICE = 'app.slice';
/**
 * VS-388's guard variable, mirrored here: a test run must never reach the host's service manager.
 * `stopScope`/`readScopeMemoryPeak` shell out to `systemctl`, so they refuse while it is set, and
 * the default availability probe reports unavailable — a unit test that wants the contained path
 * passes explicit `hasSystemdRun`/`hasUserManager` instead.
 */
export const TEST_GUARD_ENV = 'AC_TEST_GUARD';

/** The transient scope unit a run's process tree lives in. Derived from the run id, never stored. */
export function scopeUnitName(runId: string): string {
  return `ac-run-${runId}.scope`;
}

/**
 * Whether a systemd user manager is reachable: Linux, `systemd-run` on PATH, and the manager's
 * control socket present. A scratch config dir does not isolate `systemctl --user`, so this is a
 * capability check only — nothing here talks to the manager.
 */
export function systemdScopeAvailable(env: ContainmentEnvironment = {}): boolean {
  // A test that did not inject a decision must never be told the live manager is reachable.
  if (env.hasSystemdRun === undefined && env.hasUserManager === undefined && process.env[TEST_GUARD_ENV]) return false;
  const platform = env.platform ?? process.platform;
  if (platform !== 'linux') return false;
  const hasRun = env.hasSystemdRun ?? whichSync('systemd-run') !== null;
  if (!hasRun) return false;
  const hasManager = env.hasUserManager ?? userManagerSocketExists(env.runtimeDir);
  return hasManager;
}

function userManagerSocketExists(runtimeDir?: string | null): boolean {
  try {
    const dir = runtimeDir ?? process.env['XDG_RUNTIME_DIR'] ?? (typeof process.getuid === 'function' ? `/run/user/${process.getuid()}` : null);
    return dir !== null && existsSync(join(dir, 'systemd', 'private'));
  } catch {
    return false;
  }
}

/**
 * The memory settings every contained worker scope carries. Pure; the caller checks availability.
 *
 * `MemoryHigh` and `MemoryMax` are both the worker's limit. Verified on a scratch scope
 * (systemd 261, 2026-09-19): with `MemoryHigh` *below* `MemoryMax`, an allocation that reaches the
 * high mark is throttled and reclaims forever instead of being killed — the process stalls at the
 * limit rather than ending. Setting both to the limit makes the cgroup OOM fire at it
 * deterministically (`exit 137`, `OOMKills=1`), which is the clear outcome the worker needs.
 */
export function containmentPrefix(req: ContainmentRequest): ContainmentPrefix {
  const limitMb = Math.max(1, Math.floor(req.memoryMb));
  return {
    cmd: 'systemd-run',
    args: [
      '--user', '--scope', '--quiet',
      `--slice=${WORKER_SLICE}`,
      `--unit=${scopeUnitName(req.runId)}`,
      '-p', `MemoryHigh=${limitMb}M`,
      '-p', `MemoryMax=${limitMb}M`,
      '-p', 'MemorySwapMax=0',
      // OOMPolicy=kill is the kernel's `memory.oom.group=1` for a unit: when one process in it is
      // OOM-killed, the whole scope is, so a half-dead worker tree cannot limp on. (There is no
      // `MemoryOOMGroup=` property on systemd 261 — verified against a real scratch scope.)
      '-p', 'OOMPolicy=kill',
      '-p', 'ManagedOOMMemoryPressure=kill',
    ],
  };
}

/** Prefix `cmd args` with the scope wrapper, so one spawn path runs the whole worker tree contained. */
export function containCommand(cmd: string, args: string[], prefix: ContainmentPrefix): { cmd: string; args: string[] } {
  return { cmd: prefix.cmd, args: [...prefix.args, cmd, ...args] };
}

/** `systemctl --user show <unit> -p MemoryPeak` — read after a turn ends, before the scope is reset. */
export function scopeShowArgs(unit: string): { cmd: string; args: string[] } {
  return { cmd: 'systemctl', args: ['--user', 'show', unit, '-p', 'MemoryPeak'] };
}

/** `systemctl --user stop <unit>` — ends a contained worker tree regardless of its process group. */
export function scopeStopArgs(unit: string): { cmd: string; args: string[] } {
  return { cmd: 'systemctl', args: ['--user', 'stop', unit] };
}

/** Parse `MemoryPeak=NNN` from `systemctl show` output into bytes, or null when absent. */
export function parseScopeMemoryPeak(showOutput: string): number | null {
  for (const line of showOutput.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0 || line.slice(0, i).trim() !== 'MemoryPeak') continue;
    const n = Number.parseInt(line.slice(i + 1).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** Query a finished scope's peak memory, best-effort — the scope may already be gone. */
export function readScopeMemoryPeak(unit: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.env[TEST_GUARD_ENV]) { resolve(null); return; }
    try {
      const child = spawn('systemctl', scopeShowArgs(unit).args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
      child.on('error', () => resolve(null));
      child.on('close', () => resolve(parseScopeMemoryPeak(out)));
    } catch {
      resolve(null);
    }
  });
}

/** `systemctl --user reset-failed <unit>` — drop a finished scope so a failed unit does not linger. */
export function scopeResetArgs(unit: string): { cmd: string; args: string[] } {
  return { cmd: 'systemctl', args: ['--user', 'reset-failed', unit] };
}

/**
 * Release a finished transient scope: its process is gone, and once its peak has been read the
 * failed unit has no reason to stay listed. Best-effort and never blocking.
 */
export function releaseScope(unit: string): void {
  if (process.env[TEST_GUARD_ENV]) return;
  try {
    const child = spawn('systemctl', scopeResetArgs(unit).args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* nothing to release */ });
    child.unref();
  } catch {
    /* nothing to release */
  }
}

/** Stop a transient scope by unit name, best-effort and never blocking the caller. */
export function stopScope(unit: string): void {
  if (process.env[TEST_GUARD_ENV]) return;
  try {
    const child = spawn('systemctl', scopeStopArgs(unit).args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* no manager, or already gone */ });
    child.unref();
  } catch {
    /* nothing to stop */
  }
}
