import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retentionDays, sweepSessions } from './retention.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-ret-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const DAY = 86_400_000;
function file(name: string, ageDays: number, now: number): string {
  const p = join(dir, name); writeFileSync(p, '{}\n');
  const t = new Date(now - ageDays * DAY); utimesSync(p, t, t); return p;
}

describe('sweepSessions', () => {
  it('removes a 31 day old file and keeps a 2 day old one, the current one and other file types', () => {
    const now = Date.now();
    const old = file('old.jsonl', 31, now); const fresh = file('fresh.jsonl', 2, now); const current = file('current.jsonl', 90, now); const other = file('notes.txt', 90, now);
    expect(sweepSessions(dir, current, 30, now)).toEqual([old]);
    expect(existsSync(old)).toBe(false);
    for (const p of [fresh, current, other]) expect(existsSync(p)).toBe(true);
  });
  it('does nothing when the days are 0, and survives a missing directory', () => {
    const now = Date.now(); const old = file('old.jsonl', 400, now);
    expect(sweepSessions(dir, '', 0, now)).toEqual([]);
    expect(existsSync(old)).toBe(true);
    expect(sweepSessions(join(dir, 'nope'), '', 30, now)).toEqual([]);
  });
  it('reads the option with a 30 day default', () => {
    expect(retentionDays({})).toBe(30);
    expect(retentionDays({ sessionRetentionDays: 7 })).toBe(7);
    expect(retentionDays({ sessionRetentionDays: 0 })).toBe(0);
    expect(retentionDays({ sessionRetentionDays: -3 })).toBe(30);
  });
});
