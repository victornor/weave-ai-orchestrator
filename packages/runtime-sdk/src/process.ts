import { spawn, type ChildProcess } from 'node:child_process';
import { truncate, whichSync } from './fsutil.js';
import { containmentPrefix, containmentStartFailure, scopeUnitName, stopScope, systemdScopeAvailable, type ContainmentRequest } from './containment.js';

/** The process spawner, injectable so a test can drive the contained path without a real `systemd-run`. */
export type SpawnProc = typeof spawn;

export interface SpawnOpts {
  cmd: string; args: string[]; cwd: string; env: Record<string, string>; stdin?: string | null; timeoutMs: number;
  onLine(stream: 'stdout' | 'stderr', line: string): void; onSpawn?(pid: number): void;
  /**
   * `'close'` (default): write `stdin` if given, then end the stream — today's behavior. `'open'`:
   * write `stdin` if given but leave the stream writable for the process's lifetime, for a CLI whose
   * protocol requires a readable stdin to keep running. Ended on process close and on `cancel`.
   */
  stdinMode?: 'close' | 'open';
  /**
   * VS-579: when set and a systemd user manager is reachable, the CLI runs inside its own
   * memory-limited transient scope instead of the daemon's control group. Ignored otherwise.
   */
  containment?: ContainmentRequest;
  /**
   * VS-640: variables the containment wrapper itself needs (the user bus). They are set on the
   * `systemd-run` process and removed from the contained command with `env -u`, so the runtime's own
   * environment gains nothing. Ignored when the command is not wrapped.
   */
  containmentEnv?: Record<string, string>;
  /** The containment availability decision. Injected in tests so none reaches the live user manager. */
  scopeAvailable?: boolean;
  /** The spawner. Injected in tests so a fake stands in for `systemd-run`. */
  spawnProc?: SpawnProc;
}
export interface SpawnOutcome { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; /** VS-640: the wrapped `systemd-run` died without starting the command, naming the user bus. */ containmentFailed: boolean }
export interface SpawnHandle {
  done: Promise<SpawnOutcome>; cancel(mode: 'interrupt' | 'kill'): Promise<void>; write(line: string): boolean; endStdin(): void; child: ChildProcess;
  /** The transient scope this turn ran in, or null when it ran uncontained. */
  scopeUnit: string | null;
}

/**
 * What to spawn for a turn: the command itself, or a `systemd-run` wrapper when containment is
 * requested and a user manager is available. Pure, so the wiring is testable without spawning.
 *
 * Kept for callers that only need the command; `planSpawn` is the full plan `spawnLines` uses.
 */
export function resolveSpawnTarget(cmd: string, args: string[], containment: ContainmentRequest | undefined, available: boolean): { cmd: string; args: string[]; scopeUnit: string | null } {
  const plan = planSpawn({ cmd, args, env: {}, available, ...(containment ? { containment } : {}) });
  return { cmd: plan.cmd, args: plan.args, scopeUnit: plan.scopeUnit };
}

export interface SpawnPlan {
  cmd: string; args: string[];
  /** The environment the spawned process starts with — the wrapper's, when wrapped. */
  env: Record<string, string>;
  /** The environment the runtime command itself is left with, after any `env -u` inside the scope. */
  agentEnv: Record<string, string>;
  scopeUnit: string | null;
}

/**
 * VS-640: the full spawn plan. When wrapping, the wrapper environment is `env` plus `containmentEnv`
 * and the contained command is prefixed `env -u <key>` for each of those keys — `systemd-run --scope`
 * execs the command with its own environment, so a separate overlay alone would leak the user bus to
 * the runtime. Uncontained, the command runs with `env` unchanged and no key is stripped.
 */
export function planSpawn(opts: { cmd: string; args: string[]; env: Record<string, string>; containment?: ContainmentRequest; available: boolean; containmentEnv?: Record<string, string> }): SpawnPlan {
  if (!opts.containment || !opts.available) return { cmd: opts.cmd, args: opts.args, env: opts.env, agentEnv: opts.env, scopeUnit: null };
  const prefix = containmentPrefix(opts.containment);
  const keys = Object.keys(opts.containmentEnv ?? {});
  const inner = keys.length > 0 ? ['env', ...keys.flatMap((k) => ['-u', k]), opts.cmd, ...opts.args] : [opts.cmd, ...opts.args];
  return {
    cmd: prefix.cmd,
    args: [...prefix.args, ...inner],
    env: { ...opts.env, ...(opts.containmentEnv ?? {}) },
    agentEnv: opts.env,
    scopeUnit: scopeUnitName(opts.containment.runId),
  };
}

/** Spawn a CLI in its own process group — inside a memory-limited scope when asked and available — stream lines, kill the whole tree on timeout/cancel. */
export function spawnLines(opts: SpawnOpts): SpawnHandle {
  const available = opts.scopeAvailable ?? systemdScopeAvailable();
  const plan = planSpawn({
    cmd: whichSync(opts.cmd) ?? opts.cmd, args: opts.args, env: opts.env, available,
    ...(opts.containment ? { containment: opts.containment } : {}),
    ...(opts.containmentEnv ? { containmentEnv: opts.containmentEnv } : {}),
  });
  const unit = plan.scopeUnit;
  const spawnProc = opts.spawnProc ?? spawn;
  const child = spawnProc(plan.cmd, plan.args, { cwd: opts.cwd, env: plan.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (child.pid && opts.onSpawn) opts.onSpawn(child.pid);
  let timedOut = false; let stdout = ''; let stderr = ''; let stdinEnded = false;
  const buf: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const feed = (s: 'stdout' | 'stderr', chunk: Buffer) => {
    const text = chunk.toString('utf8'); if (s === 'stdout') stdout += text; else stderr += text;
    buf[s] += text; let i;
    while ((i = buf[s].indexOf('\n')) >= 0) { const line = buf[s].slice(0, i); buf[s] = buf[s].slice(i + 1); if (line.trim()) opts.onLine(s, line); }
  };
  child.stdout!.on('data', (c: Buffer) => feed('stdout', c));
  child.stderr!.on('data', (c: Buffer) => feed('stderr', c));
  // A CLI that exits before reading stdin makes a write EPIPE; the outcome is already carried by the
  // exit code, so swallow it rather than letting it surface as an unhandled stream error.
  child.stdin!.on('error', () => { stdinEnded = true; });
  const endStdin = () => { if (stdinEnded) return; stdinEnded = true; try { child.stdin!.end(); } catch { /* already gone */ } };
  // A `false` return from `stream.write` means backpressure, not failure — the data is still
  // queued and will be delivered. Report success on the write itself; only `stdinEnded` or a
  // synchronous throw means the child cannot be reached.
  const write = (line: string): boolean => {
    if (stdinEnded || !child.stdin!.writable) return false;
    try { child.stdin!.write(line); return true; } catch { stdinEnded = true; return false; }
  };
  if (opts.stdinMode === 'open') { if (opts.stdin != null) write(opts.stdin); } else if (opts.stdin != null) { stdinEnded = true; child.stdin!.end(opts.stdin); } else { stdinEnded = true; child.stdin!.end(); }
  const killGroup = (sig: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
  const timer = setTimeout(() => { timedOut = true; killGroup('SIGINT'); setTimeout(() => killGroup('SIGKILL'), 15000).unref(); }, opts.timeoutMs);
  const done = new Promise<SpawnOutcome>((resolve) => {
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      endStdin();
      for (const s of ['stdout', 'stderr'] as const) if (buf[s].trim()) opts.onLine(s, buf[s]);
      resolve({ exitCode: code, signal, timedOut, stdout, stderr, containmentFailed: unit !== null && containmentStartFailure(stderr) });
    });
    child.on('error', () => { clearTimeout(timer); resolve({ exitCode: -1, signal: null, timedOut, stdout, stderr: stderr + '\nspawn error', containmentFailed: unit !== null && containmentStartFailure(stderr) }); });
  });
  return {
    done, child, write, endStdin, scopeUnit: unit,
    cancel: async (mode) => {
      endStdin();
      // A contained tree is ended by stopping its scope, which reaches processes whatever their
      // group; the group signal remains as the fallback for uncontained spawns and a scope queue.
      if (unit) stopScope(unit);
      killGroup(mode === 'kill' ? 'SIGKILL' : 'SIGINT');
      if (mode === 'interrupt') setTimeout(() => killGroup('SIGKILL'), 30000).unref();
    },
  };
}

export function classifyError(exitCode: number | null, stderr: string): { code: string; family: RunErrorFamily; message: string } | undefined {
  if (exitCode === 0) return undefined;
  const s = stderr.toLowerCase();
  if (/rate.?limit|429|overloaded|quota|capacity|usage limit|limit reached|resets? (at|in) |out of credits|insufficient credit|spending cap|billing|out of usage/.test(s)) {
    const canned = 'provider rate limited, usage limit or quota exceeded';
    return { code: 'provider_quota', family: 'provider_quota', message: truncate(stderr.trim() || canned, 4000) };
  }
  if (/enotfound|econnreset|etimedout|502|503|504|network/.test(s)) return { code: 'transient_upstream', family: 'transient_upstream', message: 'transient upstream failure' };
  if (/unauthori[sz]ed|401|invalid api key|not logged in|login required|authentication|oauth session expired|could not be refreshed|failed to authenticate/.test(s)) return { code: 'auth', family: 'auth', message: 'runtime authentication failed' };
  if (/enoent|command not found|no such file/.test(s)) return { code: 'tooling', family: 'tooling', message: 'runtime binary or dependency missing' };
  return { code: `exit_${exitCode ?? 'signal'}`, family: 'unknown', message: truncate(stderr.trim().split('\n').pop() || `exit ${exitCode}`, 4000) };
}
import type { RunErrorFamily } from '@weave-ai/shared';
