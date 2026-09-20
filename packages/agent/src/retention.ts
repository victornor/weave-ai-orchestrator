import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Delete session files in `dir` not written to for `days` days, never `keepPath`. A session file's mtime is
 * its last use, because every turn appends to it. `days <= 0` disables the sweep. A file that cannot be
 * removed is skipped, never fatal. Returns the removed paths.
 */
export function sweepSessions(dir: string, keepPath: string, days: number, nowMs: number = Date.now()): string[] {
  if (!(days > 0)) return [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const cutoff = nowMs - days * 86_400_000;
  const removed: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    if (path === keepPath) continue;
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { force: true });
      removed.push(path);
    } catch { /* in use elsewhere or already gone */ }
  }
  return removed;
}

/** The `sessionRetentionDays` option, or the default. */
export function retentionDays(options: Record<string, unknown>): number {
  const v = options['sessionRetentionDays'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_RETENTION_DAYS;
}
