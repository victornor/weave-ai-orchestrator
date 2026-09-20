import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_RETENTION_DAYS } from '../retention.js';

/**
 * A person's sessions live apart from a worker's: `<data home>/weave-agent/sessions`. A worker's are under a
 * workspace's runtime directory, a tree this module never reads, so a ticket session cannot be listed or
 * resumed here. The format is the agent's own JSONL (`Session`); a REPL file's header says `origin:"repl"`.
 */
export function replHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env['WEAVE_AGENT_HOME'] || join(env['XDG_DATA_HOME'] || join(home, '.local', 'share'), 'weave-agent');
}
export const sessionsDir = (homeDir: string): string => join(homeDir, 'sessions');
export const spillDirFor = (homeDir: string, id: string): string => join(homeDir, 'tool-output', id);
export const newSessionId = (): string => randomUUID();
export const sessionPath = (homeDir: string, id: string): string => join(sessionsDir(homeDir), `${id}.jsonl`);
export { DEFAULT_RETENTION_DAYS };

export interface SessionInfo { id: string; path: string; cwd: string; createdAt: string; updatedAt: number; firstPrompt: string; model: string | null; provider: string | null; messages: number }

/** One bookkeeping line per turn, an entry type `Session.open` ignores: it carries what the message entries do not (the model, the person's own words). */
export function recordTurn(path: string, meta: { prompt: string; provider: string; model: string }): void {
  appendFileSync(path, `${JSON.stringify({ type: 'repl', at: new Date().toISOString(), prompt: meta.prompt.slice(0, 300), provider: meta.provider, model: meta.model })}\n`);
}

function readHead(path: string): string {
  const fd = openSync(path, 'r');
  try { const buf = Buffer.alloc(8192); const n = readSync(fd, buf, 0, buf.length, 0); return buf.subarray(0, n).toString('utf8').split('\n')[0] ?? ''; } finally { closeSync(fd); }
}

/** Read one file's header and bookkeeping; null when it is not a REPL session. */
export function describeSessionFile(path: string): SessionInfo | null {
  try {
    const head = JSON.parse(readHead(path)) as { type?: string; id?: string; cwd?: string; createdAt?: string; origin?: string };
    if (head.type !== 'session' || head.origin !== 'repl' || typeof head.id !== 'string') return null;
    let firstPrompt = ''; let model: string | null = null; let provider: string | null = null; let messages = 0;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      if (line.startsWith('{"type":"repl"')) {
        try { const m = JSON.parse(line) as { prompt?: string; model?: string; provider?: string }; if (!firstPrompt && m.prompt) firstPrompt = m.prompt; if (m.model) model = m.model; if (m.provider) provider = m.provider; } catch { /* torn line */ }
      } else if (line.includes('"type":"message"')) messages++;
    }
    return { id: head.id, path, cwd: head.cwd ?? '', createdAt: head.createdAt ?? '', updatedAt: statSync(path).mtimeMs, firstPrompt, model, provider, messages };
  } catch { return null; }
}

/** REPL sessions, newest first; only those started in `cwd` unless `all`. */
export function listSessions(homeDir: string, o: { cwd: string; all?: boolean }): SessionInfo[] {
  const dir = sessionsDir(homeDir);
  if (!existsSync(dir)) return [];
  const want = resolve(o.cwd);
  const out: SessionInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const info = describeSessionFile(join(dir, name));
    if (info && (o.all || resolve(info.cwd) === want)) out.push(info);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A session by full id, an unambiguous id prefix, or a 1-based position in `list`. */
export function findSession(list: readonly SessionInfo[], ref: string): SessionInfo | { error: string } {
  if (/^\d+$/.test(ref)) { const s = list[Number(ref) - 1]; return s ?? { error: `no session number ${ref}` }; }
  const hits = list.filter((s) => s.id === ref || s.id.startsWith(ref));
  if (hits.length === 1) return hits[0]!;
  return { error: hits.length === 0 ? `no session "${ref}"` : `"${ref}" matches ${hits.length} sessions; use more of the id` };
}

export function ensureHome(homeDir: string): void { mkdirSync(sessionsDir(homeDir), { recursive: true }); }

export function ageOf(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
