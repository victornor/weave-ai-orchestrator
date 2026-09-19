import { spawn, type ChildProcess } from 'node:child_process';
import { truncate, whichSync } from './fsutil.js';
import { containCommand, containmentPrefix, scopeUnitName, stopScope, systemdScopeAvailable, type ContainmentRequest } from './containment.js';

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
}
export interface SpawnOutcome { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
export interface SpawnHandle {
  done: Promise<SpawnOutcome>; cancel(mode: 'interrupt' | 'kill'): Promise<void>; write(line: string): boolean; endStdin(): void; child: ChildProcess;
  /** The transient scope this turn ran in, or null when it ran uncontained. */
  scopeUnit: string | null;
}

/**
 * What to spawn for a turn: the command itself, or a `systemd-run` wrapper when containment is
 * requested and a user manager is available. Pure, so the wiring is testable without spawning.
 */
export function resolveSpawnTarget(cmd: string, args: string[], containment: ContainmentRequest | undefined, available: boolean): { cmd: string; args: string[]; scopeUnit: string | null } {
  if (!containment || !available) return { cmd, args, scopeUnit: null };
  const wrapped = containCommand(cmd, args, containmentPrefix(containment));
  return { cmd: wrapped.cmd, args: wrapped.args, scopeUnit: scopeUnitName(containment.runId) };
}

/** Spawn a CLI in its own process group — inside a memory-limited scope when asked and available — stream lines, kill the whole tree on timeout/cancel. */
export function spawnLines(opts: SpawnOpts): SpawnHandle {
  const target = resolveSpawnTarget(whichSync(opts.cmd) ?? opts.cmd, opts.args, opts.containment, systemdScopeAvailable());
  const unit = target.scopeUnit;
  const child = spawn(target.cmd, target.args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
      resolve({ exitCode: code, signal, timedOut, stdout, stderr });
    });
    child.on('error', () => { clearTimeout(timer); resolve({ exitCode: -1, signal: null, timedOut, stdout, stderr: stderr + '\nspawn error' }); });
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
