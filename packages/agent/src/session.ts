import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from './types.js';

export interface SessionRef { v: 1; id: string; path: string; leafId: string | null }

interface MessageEntry { id: string; parentId: string | null; type: 'message'; message: Message }

/**
 * A session is a JSONL file: a header line, then one entry per message in the agent's own content-block
 * form (never wire JSON). Entries carry `parentId` so a later tree, fork or compaction needs no new
 * format; this slice reads them as one chain. Every append is one whole line, fsynced, and a torn
 * last line (a crash mid-write) is dropped on load.
 */
export class Session {
  private constructor(readonly id: string, readonly path: string, readonly messages: Message[], private leaf: string | null, private fd: number) {}

  static open(opts: { path: string; id: string; cwd: string }): Session {
    const messages: Message[] = [];
    let leaf: string | null = null;
    if (existsSync(opts.path)) {
      for (const line of readFileSync(opts.path, 'utf8').split('\n')) {
        if (!line) continue;
        let e: unknown;
        try { e = JSON.parse(line); } catch { continue; }
        if (isMessageEntry(e)) { messages.push(e.message); leaf = e.id; }
      }
    } else {
      mkdirSync(dirname(opts.path), { recursive: true });
      appendFileSync(opts.path, JSON.stringify({ type: 'session', v: 1, id: opts.id, createdAt: new Date().toISOString(), cwd: opts.cwd }) + '\n');
    }
    // A torn last line has no newline: make sure the next entry starts on its own line.
    const raw = existsSync(opts.path) ? readFileSync(opts.path, 'utf8') : '';
    if (raw && !raw.endsWith('\n')) appendFileSync(opts.path, '\n');
    return new Session(opts.id, opts.path, messages, leaf, openSync(opts.path, 'a'));
  }

  append(message: Message): void {
    const entry: MessageEntry = { id: randomUUID().slice(0, 8), parentId: this.leaf, type: 'message', message };
    writeSync(this.fd, JSON.stringify(entry) + '\n');
    fsyncSync(this.fd);
    this.messages.push(message);
    this.leaf = entry.id;
  }

  ref(): SessionRef { return { v: 1, id: this.id, path: this.path, leafId: this.leaf }; }
  close(): void { try { closeSync(this.fd); } catch { /* already closed */ } }
}

function isMessageEntry(e: unknown): e is MessageEntry {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  const m = o['message'] as Record<string, unknown> | undefined;
  return o['type'] === 'message' && typeof o['id'] === 'string' && typeof m === 'object' && m !== null && (m['role'] === 'user' || m['role'] === 'assistant' || m['role'] === 'toolResult');
}
