import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnOpts { cmd: string; args: string[]; cwd: string; env: Record<string, string>; stdin?: string | null; timeoutMs: number; onLine(stream: 'stdout' | 'stderr', line: string): void; onSpawn?(pid: number): void }
export interface SpawnOutcome { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }

/** Spawn a CLI in its own process group, stream lines, kill the whole group on timeout/cancel. */
export function spawnLines(opts: SpawnOpts): { done: Promise<SpawnOutcome>; cancel(mode: 'interrupt' | 'kill'): Promise<void>; child: ChildProcess } {
  const child = spawn(opts.cmd, opts.args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (child.pid && opts.onSpawn) opts.onSpawn(child.pid);
  let timedOut = false; let stdout = ''; let stderr = '';
  const buf: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const feed = (s: 'stdout' | 'stderr', chunk: Buffer) => {
    const text = chunk.toString('utf8'); if (s === 'stdout') stdout += text; else stderr += text;
    buf[s] += text; let i;
    while ((i = buf[s].indexOf('\n')) >= 0) { const line = buf[s].slice(0, i); buf[s] = buf[s].slice(i + 1); if (line.trim()) opts.onLine(s, line); }
  };
  child.stdout!.on('data', (c: Buffer) => feed('stdout', c));
  child.stderr!.on('data', (c: Buffer) => feed('stderr', c));
  if (opts.stdin != null) { child.stdin!.end(opts.stdin); } else { child.stdin!.end(); }
  const killGroup = (sig: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
  const timer = setTimeout(() => { timedOut = true; killGroup('SIGINT'); setTimeout(() => killGroup('SIGKILL'), 15000).unref(); }, opts.timeoutMs);
  const done = new Promise<SpawnOutcome>((resolve) => {
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      for (const s of ['stdout', 'stderr'] as const) if (buf[s].trim()) opts.onLine(s, buf[s]);
      resolve({ exitCode: code, signal, timedOut, stdout, stderr });
    });
    child.on('error', () => { clearTimeout(timer); resolve({ exitCode: -1, signal: null, timedOut, stdout, stderr: stderr + '\nspawn error' }); });
  });
  return { done, child, cancel: async (mode) => { killGroup(mode === 'kill' ? 'SIGKILL' : 'SIGINT'); if (mode === 'interrupt') setTimeout(() => killGroup('SIGKILL'), 30000).unref(); } };
}

export function classifyError(exitCode: number | null, stderr: string): { code: string; family: RunErrorFamily; message: string } | undefined {
  if (exitCode === 0) return undefined;
  const s = stderr.toLowerCase();
  if (/rate.?limit|429|overloaded|quota|capacity|usage limit|limit reached|resets? (at|in) |out of credits|insufficient credit|spending cap|billing/.test(s)) return { code: 'provider_quota', family: 'provider_quota', message: 'provider rate limited, usage limit or quota exceeded' };
  if (/enotfound|econnreset|etimedout|502|503|504|network/.test(s)) return { code: 'transient_upstream', family: 'transient_upstream', message: 'transient upstream failure' };
  if (/unauthori[sz]ed|401|invalid api key|not logged in|login required|authentication|oauth session expired|could not be refreshed|failed to authenticate/.test(s)) return { code: 'auth', family: 'auth', message: 'runtime authentication failed' };
  if (/enoent|command not found|no such file/.test(s)) return { code: 'tooling', family: 'tooling', message: 'runtime binary or dependency missing' };
  return { code: `exit_${exitCode ?? 'signal'}`, family: 'unknown', message: (stderr.trim().split('\n').pop() || `exit ${exitCode}`).slice(0, 500) };
}
import type { RunErrorFamily } from '@agent-conductor/shared';
