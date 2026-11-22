/**
 * The `--gemini_dir` self-check (VS-995, design §1). Config isolation rests on a flag agy 1.5.14
 * accepts but does not document, so before trusting it the adapter seeds a scratch dir with one
 * MCP server and asks `agy --gemini_dir <scratch> mcp list` what it sees. It must list that server
 * and nothing else — otherwise a worker could load the machine owner's servers, and the runtime
 * is refused instead. `mcp list` reads local config only: no login, no network.
 *
 * Output shape, captured from 1.5.14 in a sandbox:
 *   NAME               TYPE   STATUS   COMMAND/URL
 *   captains-personal  stdio  enabled  true
 * and `No MCP servers configured.` when the file is empty.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpConfigJson, mcpConfigPath } from './args.js';

export const PROBE_SERVER = 'weave-isolation-probe';

export type IsolationResult = { ok: true } | { ok: false; reason: string };

/** Server names from `agy mcp list` output: the first column of every row after the header. */
export function parseMcpList(stdout: string): string[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0 || /^No MCP servers configured/i.test(lines[0]!)) return [];
  const body = /^NAME\s+TYPE\b/.test(lines[0]!) ? lines.slice(1) : lines;
  return body.map((l) => l.split(/\s+/)[0]!).filter((n) => n.length > 0);
}

/** Judge one `mcp list` run against the seeded server. Pure, for tests. */
export function judgeIsolation(run: { exitCode: number | null; stdout: string; stderr: string }): IsolationResult {
  if (run.exitCode !== 0) {
    const why = (run.stderr.trim().split('\n').pop() ?? '').slice(0, 300);
    return { ok: false, reason: `agy --gemini_dir isolation check failed: \`agy --gemini_dir <dir> mcp list\` exited ${run.exitCode}${why ? ` (${why})` : ''}` };
  }
  const names = parseMcpList(run.stdout);
  if (names.length === 1 && names[0] === PROBE_SERVER) return { ok: true };
  return { ok: false, reason: `agy --gemini_dir isolation check failed: expected only "${PROBE_SERVER}", agy listed ${names.length ? names.map((n) => `"${n}"`).join(', ') : 'nothing'}` };
}

function runList(cmd: string, dir: string, env: Record<string, string>, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(cmd, ['--gemini_dir', dir, 'mcp', 'list'], { env, timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null) : 0;
      done({ exitCode: code, stdout: String(stdout ?? ''), stderr: String(stderr ?? (err ? err.message : '')) });
    });
  });
}

/** Seed a scratch dir, run the check, clean up. Never throws. */
export async function checkIsolation(cmd: string, env: Record<string, string>, timeoutMs = 20_000): Promise<IsolationResult> {
  const dir = mkdtempSync(join(tmpdir(), 'weave-agy-isolation-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(mcpConfigPath(dir), mcpConfigJson({ [PROBE_SERVER]: { type: 'stdio', command: 'true', args: [] } }));
    return judgeIsolation(await runList(cmd, dir, env, timeoutMs));
  } catch (e) {
    return { ok: false, reason: `agy --gemini_dir isolation check could not run: ${(e as Error).message}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const cache = new Map<string, Promise<IsolationResult>>();

/** Once per process per binary (path + mtime): a replaced binary is checked again. */
export function checkIsolationCached(cmd: string, env: Record<string, string>): Promise<IsolationResult> {
  let stamp = '';
  try { stamp = String(statSync(cmd).mtimeMs); } catch { stamp = 'unknown'; }
  const key = `${cmd}\0${stamp}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = checkIsolation(cmd, env);
    cache.set(key, hit);
    // A failure is not remembered: a fixed install is picked up on the next turn.
    void hit.then((r) => { if (!r.ok) cache.delete(key); });
  }
  return hit;
}
