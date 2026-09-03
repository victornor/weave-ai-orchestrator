import { execa } from 'execa';

export interface ExecResult { ok: boolean; exitCode: number | null; stdout: string; stderr: string; failed: boolean }

/** Run a command without throwing. Every call names an explicit cwd and timeout. */
export async function sh(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number; env?: Record<string, string>; input?: string }): Promise<ExecResult> {
  try {
    const r = await execa(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 60_000,
      reject: false,
      all: false,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      input: opts.input,
    });
    const exitCode = typeof r.exitCode === 'number' ? r.exitCode : null;
    return { ok: exitCode === 0, exitCode, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), failed: exitCode !== 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, exitCode: null, stdout: '', stderr: msg, failed: true };
  }
}

/** Run a shell command line (used for project setup commands, which are written as shell strings). */
export async function shell(line: string, opts: { cwd: string; timeoutMs?: number; env?: Record<string, string> }): Promise<ExecResult> {
  return sh(process.env.SHELL && process.env.SHELL.length ? process.env.SHELL : '/bin/sh', ['-lc', line], opts);
}

export async function binaryExists(bin: string): Promise<boolean> {
  const r = await sh('sh', ['-c', `command -v ${JSON.stringify(bin).slice(1, -1)}`], { cwd: process.cwd(), timeoutMs: 5000 });
  return r.ok && r.stdout.trim().length > 0;
}
