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

  it('creates the workspace-scoped jobs table with its entity index', () => {
    const db = openDb(join(dir, 'e.sqlite'));
    const cols = db.all<{ name: string }>('PRAGMA table_info(jobs)').map((c) => c.name);
    expect(cols).toEqual([
      'id', 'workspace_id', 'kind', 'entity_type', 'entity_id', 'state',
      'steps_json', 'log_json', 'log_seq', 'requested_by', 'started_at', 'finished_at', 'failed_step', 'message',
    ]);
    expect(db.all<{ name: string }>('PRAGMA index_list(jobs)').map((i) => i.name)).toContain('jobs_entity');
    db.close();
  });

  it('round-trips a job steps and log JSON columns as arrays', () => {
    const db = openDb(join(dir, 'f.sqlite'));
    db.insert('jobs', {
      id: 'j1', workspaceId: 'w1', kind: 'project_add', entityType: 'project', entityId: 'p1', state: 'running',
      stepsJson: [{ id: 'clone', label: 'Clone the repository', state: 'running', startedAt: null, endedAt: null }],
      logJson: [{ seq: 1, step: 'clone', stream: 'stderr', text: 'Cloning into…' }],
      logSeq: 1, requestedBy: 'human:victor', startedAt: '2026-09-05T00:00:00.000Z',
    });
    const row = db.get<{ steps: Array<{ id: string }>; log: Array<{ text: string }>; logSeq: number }>('SELECT * FROM jobs WHERE id = ?', ['j1']);
    expect(row?.steps.map((s) => s.id)).toEqual(['clone']);
    expect(row?.log[0]?.text).toBe('Cloning into…');
    expect(row?.logSeq).toBe(1);
    db.close();
  });
});
