import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorOutput, type ToolCtx, type ToolDefinition, type ToolOutput } from './index.js';

export const BASH_MAX_CHARS = 30_000;
export const BASH_MAX_LINES = 2000;
const HARD_MEMORY_CAP = 32 * 1024 * 1024;
const KILL_GRACE_MS = 3000;

/** Every descendant of `pid`, deepest first, from one `ps` snapshot. */
function descendants(pid: number): number[] {
  const r = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const kids = new Map<number, number[]>();
  for (const line of r.stdout.split('\n')) {
    const [c, p] = line.trim().split(/\s+/).map(Number);
    if (c === undefined || p === undefined || Number.isNaN(c) || Number.isNaN(p)) continue;
    kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  const out: number[] = [];
  const walk = (p: number): void => { for (const c of kids.get(p) ?? []) { walk(c); out.push(c); } };
  walk(pid);
  return out;
}

/**
 * The shell runs in the agent's own process group, so a group kill by the supervisor reaches it; the
 * tool therefore stops it by walking its process tree instead of signalling a group of its own.
 */
export function killTree(pid: number, signal: NodeJS.Signals): void {
  for (const p of [...descendants(pid), pid]) { try { process.kill(p, signal); } catch { /* already gone */ } }
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Run a shell command in the worktree. Each call is a fresh shell; stdout and stderr are merged. Long output is truncated to its tail and the full text saved to a file named in the result.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['command'],
    properties: {
      command: { type: 'string' },
      timeout: { type: 'integer', minimum: 1, maximum: 600, default: 120, description: 'seconds' },
      description: { type: 'string' },
    },
  },
  async run(args, ctx) {
    if (typeof args['command'] !== 'string' || !args['command'].trim()) return errorOutput('command is required');
    const command = args['command'];
    const timeoutSec = typeof args['timeout'] === 'number' ? Math.min(600, Math.max(1, Math.floor(args['timeout']))) : 120;
    return runShell(command, timeoutSec, ctx);
  },
};

function runShell(command: string, timeoutSec: number, ctx: ToolCtx): Promise<ToolOutput> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], { cwd: ctx.cwd, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: string[] = [];
    let size = 0;
    let dropped = false;
    const take = (b: Buffer): void => {
      if (size >= HARD_MEMORY_CAP) { dropped = true; return; }
      const s = b.toString('utf8');
      size += s.length;
      chunks.push(s);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      if (child.pid === undefined) return;
      killTree(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => { if (child.pid !== undefined) killTree(child.pid, 'SIGKILL'); }, KILL_GRACE_MS);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutSec * 1000);
    const onAbort = (): void => stop();
    if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    const finish = (code: number | null, err?: Error): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      ctx.signal.removeEventListener('abort', onAbort);
      if (err) { resolve(errorOutput(err.message)); return; }
      resolve(format(chunks.join(''), dropped, code, timedOut, timeoutSec, ctx, command));
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

function format(full: string, dropped: boolean, code: number | null, timedOut: boolean, timeoutSec: number, ctx: ToolCtx, command: string): ToolOutput {
  const lines = full.split('\n');
  const overLines = lines.length > BASH_MAX_LINES;
  const overChars = full.length > BASH_MAX_CHARS;
  let text = full;
  let footer = '';
  if (overLines || overChars || dropped) {
    let tail = overLines ? lines.slice(-BASH_MAX_LINES).join('\n') : full;
    if (tail.length > BASH_MAX_CHARS) tail = tail.slice(-BASH_MAX_CHARS);
    mkdirSync(ctx.spillDir, { recursive: true });
    const spill = join(ctx.spillDir, `${ctx.callId.replace(/[^A-Za-z0-9_-]/g, '_')}.txt`);
    writeFileSync(spill, full);
    text = tail;
    footer = `\n[output truncated to the last ${tail.length} characters${dropped ? ' (capture limit reached)' : ''}; full output: ${spill}]`;
  }
  if (timedOut) footer += `\n[timed out after ${timeoutSec}s]`;
  const exit = timedOut ? null : code;
  return { text: `${text}${footer}\nexit code: ${exit ?? 'none'}`, isError: timedOut || (code !== null && code !== 0), meta: { command, exitCode: exit } };
}
