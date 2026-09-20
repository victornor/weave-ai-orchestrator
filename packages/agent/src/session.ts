import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from './types.js';

export interface SessionRef { v: 1; id: string; path: string; leafId: string | null }

interface MessageEntry { id: string; parentId: string | null; type: 'message'; message: Message }
export interface FileLists { read: string[]; modified: string[] }
export interface CompactionRecord { summary: string; firstKeptEntryId: string; tokensBefore: number; tokensAfter: number; files: FileLists }
interface CompactionEntry extends CompactionRecord { id: string; parentId: string | null; type: 'compaction'; at: string }

/** The user message a summary is shown as. */
export const SUMMARY_PREFIX = '[Conversation summary]\n';

/**
 * A session is a JSONL file: a header line, then one entry per message in the agent's own content-block
 * form (never wire JSON) and one per compaction. Entries carry `parentId` and form one chain. The file is
 * append-only: a compaction does not delete anything, it moves where the history the model sees starts.
 * Every append is one whole line, fsynced, and a torn last line (a crash mid-write) is dropped on load.
 */
export class Session {
  /** Every message ever appended, oldest first, compacted or not. */
  readonly messages: Message[];
  private constructor(readonly id: string, readonly path: string, messages: Message[], private ids: string[], private compaction: CompactionRecord | null, private leaf: string | null, private fd: number) { this.messages = messages; }

  static open(opts: { path: string; id: string; cwd: string }): Session {
    const messages: Message[] = [];
    const ids: string[] = [];
    let compaction: CompactionRecord | null = null;
    let leaf: string | null = null;
    if (existsSync(opts.path)) {
      for (const line of readFileSync(opts.path, 'utf8').split('\n')) {
        if (!line) continue;
        let e: unknown;
        try { e = JSON.parse(line); } catch { continue; }
        if (isMessageEntry(e)) { messages.push(e.message); ids.push(e.id); leaf = e.id; }
        else if (isCompactionEntry(e)) { compaction = { summary: e.summary, firstKeptEntryId: e.firstKeptEntryId, tokensBefore: e.tokensBefore, tokensAfter: e.tokensAfter, files: e.files }; leaf = e.id; }
      }
    } else {
      mkdirSync(dirname(opts.path), { recursive: true });
      appendFileSync(opts.path, JSON.stringify({ type: 'session', v: 1, id: opts.id, createdAt: new Date().toISOString(), cwd: opts.cwd }) + '\n');
    }
    // A torn last line has no newline: make sure the next entry starts on its own line.
    const raw = existsSync(opts.path) ? readFileSync(opts.path, 'utf8') : '';
    if (raw && !raw.endsWith('\n')) appendFileSync(opts.path, '\n');
    return new Session(opts.id, opts.path, messages, ids, compaction, leaf, openSync(opts.path, 'a'));
  }

  append(message: Message): void {
    const entry: MessageEntry = { id: randomUUID().slice(0, 8), parentId: this.leaf, type: 'message', message };
    this.write(entry);
    this.messages.push(message);
    this.ids.push(entry.id);
    this.leaf = entry.id;
  }

  /** The latest compaction, or null. */
  get lastCompaction(): CompactionRecord | null { return this.compaction; }

  /** The entry id of `messages[index]`. */
  entryId(index: number): string | undefined { return this.ids[index]; }

  /** Index into `messages` where the visible history starts: 0 with no compaction. */
  get keptFrom(): number {
    if (!this.compaction) return 0;
    const i = this.ids.indexOf(this.compaction.firstKeptEntryId);
    return i < 0 ? 0 : i;
  }

  /** What the model sees: the summary (when compacted) as a user message, then the kept messages to the leaf. */
  context(): Message[] {
    const kept = this.messages.slice(this.keptFrom);
    return this.compaction ? [{ role: 'user', text: `${SUMMARY_PREFIX}${this.compaction.summary}` }, ...kept] : kept;
  }

  /** Record a compaction. `firstKeptIndex` is an index into `messages`. */
  compact(rec: { summary: string; firstKeptIndex: number; tokensBefore: number; tokensAfter: number; files: FileLists }): void {
    const firstKeptEntryId = this.ids[rec.firstKeptIndex];
    if (firstKeptEntryId === undefined) throw new Error('compaction cut is past the end of the session');
    const entry: CompactionEntry = { id: randomUUID().slice(0, 8), parentId: this.leaf, type: 'compaction', at: new Date().toISOString(), summary: rec.summary, firstKeptEntryId, tokensBefore: rec.tokensBefore, tokensAfter: rec.tokensAfter, files: rec.files };
    this.write(entry);
    this.compaction = { summary: rec.summary, firstKeptEntryId, tokensBefore: rec.tokensBefore, tokensAfter: rec.tokensAfter, files: rec.files };
    this.leaf = entry.id;
  }

  ref(): SessionRef { return { v: 1, id: this.id, path: this.path, leafId: this.leaf }; }
  close(): void { try { closeSync(this.fd); } catch { /* already closed */ } }

  private write(entry: MessageEntry | CompactionEntry): void {
    writeSync(this.fd, JSON.stringify(entry) + '\n');
    fsyncSync(this.fd);
  }
}

/** Copy a session file under a new id: the same entries, a new header, so the fork and the original diverge from here. */
export function forkSessionFile(from: string, to: string, id: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  const lines = readFileSync(to, 'utf8').split('\n');
  const head = lines[0] ? safeParse(lines[0]) : null;
  if (head && head['type'] === 'session') {
    lines[0] = JSON.stringify({ ...head, id, forkedFrom: head['id'] });
    appendAtomic(to, lines.join('\n'));
  }
}

function appendAtomic(path: string, text: string): void {
  const fd = openSync(path, 'w');
  try { writeSync(fd, text.endsWith('\n') ? text : `${text}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
function safeParse(s: string): Record<string, unknown> | null { try { const v: unknown = JSON.parse(s); return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null; } catch { return null; } }

function isMessageEntry(e: unknown): e is MessageEntry {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  const m = o['message'] as Record<string, unknown> | undefined;
  return o['type'] === 'message' && typeof o['id'] === 'string' && typeof m === 'object' && m !== null && (m['role'] === 'user' || m['role'] === 'assistant' || m['role'] === 'toolResult');
}
function isCompactionEntry(e: unknown): e is CompactionEntry {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  const f = o['files'] as Record<string, unknown> | undefined;
  return o['type'] === 'compaction' && typeof o['id'] === 'string' && typeof o['summary'] === 'string' && typeof o['firstKeptEntryId'] === 'string' && typeof f === 'object' && f !== null && Array.isArray(f['read']) && Array.isArray(f['modified']);
}
