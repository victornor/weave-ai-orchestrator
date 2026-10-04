import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@weave-ai/db';
import { seedLumen, seedDaemonIncidents } from './seed.js';
import { seedFernwood } from './seedFernwood.js';
import { buildProjectRepo } from './clones.js';
import { assertDemoTarget, LIVE_PORT, DEMO_MARKER } from './index.js';
import { demoId } from './ids.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'weave-demo-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Every table, every row, in a stable order: what "identical data" means. */
function dump(db: Db): string {
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%\\_search\\_%' ESCAPE '\\' AND name NOT LIKE 'knowledge_search%' ORDER BY name");
  const out: string[] = [];
  for (const { name } of tables) {
    const rows = db.all<Record<string, unknown>>(`SELECT * FROM "${name}"`).map((r) => JSON.stringify(r));
    out.push(`${name}\n${rows.sort().join('\n')}`);
  }
  return out.join('\n\n');
}

function seeded(file: string, seed: typeof seedLumen): Db {
  const db = openDb(join(dir, file));
  seed({ db, root: '/demo/root' });
  return db;
}

describe('the demo seed (VS-770)', () => {
  it('is deterministic: two seeds into empty databases are identical', () => {
    const a = seeded('a.sqlite', seedLumen);
    const b = seeded('b.sqlite', seedLumen);
    const first = dump(a);
    expect(first.length).toBeGreaterThan(50_000);
    expect(dump(b)).toBe(first);
    a.close(); b.close();
  });

  it('seeds the second workspace and the daemon incidents deterministically too', () => {
    const a = seeded('fa.sqlite', seedFernwood);
    const b = seeded('fb.sqlite', seedFernwood);
    expect(dump(a)).toBe(dump(b));
    a.close(); b.close();
    const d1 = openDb(join(dir, 'd1.sqlite')); const d2 = openDb(join(dir, 'd2.sqlite'));
    seedDaemonIncidents(d1); seedDaemonIncidents(d2);
    expect(dump(d1)).toBe(dump(d2));
    expect(d1.all("SELECT * FROM incidents WHERE resolved_at IS NULL").length).toBe(2);
    d1.close(); d2.close();
  });

  it('covers every ticket status and kind, every worker state and every decision kind a view needs', () => {
    const db = seeded('cov.sqlite', seedLumen);
    const col = (sql: string): string[] => db.all<{ v: string }>(sql).map((r) => r.v).sort();
    expect(col('SELECT DISTINCT status AS v FROM tickets')).toEqual(['approved', 'backlog', 'blocked', 'cancelled', 'done', 'in_progress', 'in_review', 'merging', 'proposed', 'proposing', 'todo']);
    expect(col('SELECT DISTINCT kind AS v FROM tickets')).toEqual(['change', 'operational', 'question', 'scout', 'task']);
    expect(col("SELECT DISTINCT status AS v FROM agents WHERE kind = 'worker'")).toEqual(expect.arrayContaining(['running', 'active', 'paused', 'error', 'done']));
    expect(col("SELECT DISTINCT kind AS v FROM decisions WHERE status = 'open'")).toEqual(expect.arrayContaining(['plan_approval', 'merge_approval', 'action_approval', 'question', 'hire_approval', 'promotion_approval']));
    expect(col("SELECT DISTINCT weaver_review_status AS v FROM decisions")).toEqual(['concerns', 'looked', 'unseen']);
    expect(col("SELECT DISTINCT status AS v FROM roles")).toEqual(['active', 'paused', 'pending_activation']);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM decisions WHERE status = 'open' AND inputs_json != '[]'")?.n).toBeGreaterThan(0);
    db.close();
  });

  it('uses only invented names: no real host in a git URL or work product', () => {
    const db = seeded('names.sqlite', seedLumen);
    for (const r of db.all<{ v: string }>('SELECT git_url AS v FROM projects')) expect(r.v).toMatch(/\.example[:/]/);
    db.close();
  });
});

describe('the demo project repositories', () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  it('are built from fixed dates and authors, so their commit ids never change', () => {
    buildProjectRepo('ledger', join(dir, 'r1'), join(dir, 'c1'));
    buildProjectRepo('ledger', join(dir, 'r2'), join(dir, 'c2'));
    expect(git(join(dir, 'c1'), 'rev-parse', 'HEAD')).toBe(git(join(dir, 'c2'), 'rev-parse', 'HEAD'));
    expect(git(join(dir, 'c1'), 'log', '--format=%an', '-1')).toBe('Priya Anand');
  });

  it('leave storefront with a landing branch ahead of main, as the promotion card says', () => {
    buildProjectRepo('storefront', join(dir, 'r'), join(dir, 'c'));
    expect(git(join(dir, 'c'), 'rev-list', '--count', 'origin/main..origin/edge')).toBe('3');
  });
});

describe('demo mode refuses the live daemon (VS-770)', () => {
  it('refuses the live port', () => {
    expect(() => assertDemoTarget(join(dir, 'x'), LIVE_PORT)).toThrow(/7433/);
  });

  it('refuses the live config directory', () => {
    const previous = process.env['AC_CONFIG_HOME'];
    process.env['AC_CONFIG_HOME'] = join(dir, 'live');
    try { expect(() => assertDemoTarget(join(dir, 'live'), 0)).toThrow(/live config directory/); }
    finally { if (previous === undefined) delete process.env['AC_CONFIG_HOME']; else process.env['AC_CONFIG_HOME'] = previous; }
  });

  it('refuses a non-empty directory that demo mode did not create, and accepts one it did', () => {
    const other = join(dir, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'precious.txt'), 'keep me');
    expect(() => assertDemoTarget(other, 0)).toThrow(/not empty/);
    writeFileSync(join(other, DEMO_MARKER), 'x');
    expect(() => assertDemoTarget(other, 0)).not.toThrow();
  });

  it('derives ids from labels', () => {
    expect(demoId('a')).toBe(demoId('a'));
    expect(demoId('a')).not.toBe(demoId('b'));
    expect(demoId('a')).toHaveLength(26);
  });
});
