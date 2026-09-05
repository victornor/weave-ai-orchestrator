import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './repos.js';
import { Db } from './db.js';

describe('migrations', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ac-db-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const columns = (db: Db): string[] => db.all<{ name: string }>('PRAGMA table_info(tickets)').map((c) => c.name);

  it('gives tickets the merge queue columns and an index over them', () => {
    const db = openDb(join(dir, 'a.sqlite'));
    expect(columns(db)).toEqual(expect.arrayContaining(['merge_queued_at', 'merge_started_at']));
    const idx = db.all<{ name: string }>('PRAGMA index_list(tickets)').map((i) => i.name);
    expect(idx).toContain('tickets_merge_queue');
    db.close();
  });

  it('is a no-op when it runs again on the same file', () => {
    const path = join(dir, 'b.sqlite');
    const first = openDb(path);
    const before = columns(first);
    first.close();
    const second = openDb(path);
    expect(columns(second)).toEqual(before);
    expect(second.all<{ value: string }>("SELECT value FROM meta WHERE key = 'migration:0005_merge_queue.sql'")).toHaveLength(1);
    second.close();
  });

  it('creates the daemon-level upgrades table with no workspace scope', () => {
    const db = openDb(join(dir, 'c.sqlite'));
    const cols = db.all<{ name: string }>('PRAGMA table_info(upgrades)').map((c) => c.name);
    expect(cols).toEqual([
      'id', 'state', 'source', 'ref', 'run_test', 'target_sha', 'from_release', 'to_release', 'to_sha',
      'requested_by', 'requested_at', 'started_at', 'finished_at', 'reason', 'message',
      'log_json', 'backups_json', 'came_back_version',
    ]);
    expect(cols).not.toContain('workspace_id');
    expect(db.all<{ table: string }>('PRAGMA foreign_key_list(upgrades)')).toHaveLength(0);
    db.close();
  });

  it('round-trips an upgrade JSON column as an array', () => {
    const db = openDb(join(dir, 'd.sqlite'));
    db.insert('upgrades', {
      id: 'u1', state: 'queued', source: '/src', ref: 'main', requestedBy: 'operator',
      requestedAt: '2026-09-05T00:00:00.000Z', logJson: ['$ git clone'], backupsJson: [],
    });
    const row = db.get<{ log: string[]; backups: string[]; state: string }>('SELECT * FROM upgrades WHERE id = ?', ['u1']);
    expect(row?.state).toBe('queued');
    expect(row?.log).toEqual(['$ git clone']);
    expect(row?.backups).toEqual([]);
    db.close();
  });
});
