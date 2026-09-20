/**
 * The turn's read ledger (runtime-details section 5, VS-608). A successful `read` records the file's
 * resolved path, modification time, size and content hash; a `write` to an existing file and every
 * `edit` compare against it first and refuse a file that changed since it was read. The ledger is
 * per turn because the child is spawned per turn — after a resume the model re-reads, which is the
 * cheap side of the trade.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export interface LedgerEntry { path: string; mtimeMs: number; size: number; sha1: string }

export const sha1 = (buf: Buffer): string => createHash('sha1').update(buf).digest('hex');

export class ReadLedger {
  private entries = new Map<string, LedgerEntry>();

  /** Record a fresh read of `path`. Unreadable files are not recorded. */
  record(path: string): LedgerEntry | undefined {
    try {
      const st = statSync(path);
      if (!st.isFile()) return undefined;
      const entry: LedgerEntry = { path, mtimeMs: st.mtimeMs, size: st.size, sha1: sha1(readFileSync(path)) };
      this.entries.set(path, entry);
      return entry;
    } catch { return undefined; }
  }

  /** Update an entry after a successful write without re-reading the whole file. */
  refresh(path: string, bytes: Buffer): LedgerEntry {
    const st = statSync(path);
    const entry: LedgerEntry = { path, mtimeMs: st.mtimeMs, size: st.size, sha1: sha1(bytes) };
    this.entries.set(path, entry);
    return entry;
  }

  has(path: string): boolean { return this.entries.has(path); }

  /** `missing` when the path was never read; `stale` when it changed since. */
  check(path: string): 'ok' | 'missing' | 'stale' {
    const entry = this.entries.get(path);
    if (!entry) return 'missing';
    try {
      const st = statSync(path);
      if (st.mtimeMs !== entry.mtimeMs || st.size !== entry.size) return 'stale';
      return sha1(readFileSync(path)) === entry.sha1 ? 'ok' : 'stale';
    } catch { return 'stale'; }
  }
}