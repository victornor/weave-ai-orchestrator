import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECISION_KINDS } from '@agent-conductor/shared';
import { openDb } from './repos.js';
import { Db } from './db.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * A database as it stood before `through` was written: the same loop `Db.migrate()` runs, stopped
 * early and with the applied files recorded, so reopening it with `openDb` applies only the rest.
 */
function openDbAsOf(path: string, through: string): Db {
  const db = new Db(path);
  db.sqlite.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
    if (f > through) break;
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    db.run('INSERT INTO meta(key, value) VALUES (?, ?)', [`migration:${f}`, f]);
  }
  return db;
}

/** The `kind` CHECK as SQLite stored it, which is the only account of what the column really accepts. */
function persistedDecisionKinds(db: Db): string[] {
  const ddl = db.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decisions'")!.sql;
  const clause = /kind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(ddl);
  if (!clause) throw new Error(`no kind CHECK found in: ${ddl}`);
  return clause[1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
}

/** A ticket is the only row `decisions.ticket_id` will accept, and it needs a workspace. */
function seedTicket(db: Db, ids: { workspace: string; ticket: string }): void {
  db.run(
    `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
     VALUES (?, 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`, [ids.workspace]);
  db.run(
    `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
     VALUES (?, ?, 1, 'VS-1', 'change', 'Add dark mode', 'human', 't0', 't0')`, [ids.ticket, ids.workspace]);
}

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

  describe('0010_decision_kinds', () => {
    const insertDecision = (db: Db, over: Record<string, unknown>) =>
      db.insert('decisions', {
        workspaceId: 'w1', kind: 'approval', owner: 'human', title: 'Approve', status: 'open', createdAt: 't1', ...over,
      });

    it('widens the kind CHECK while preserving the decisions already stored', () => {
      const path = join(dir, 'g.sqlite');
      const before = openDbAsOf(path, '0009_jobs.sql');
      seedTicket(before, { workspace: 'w1', ticket: 't1' });
      insertDecision(before, {
        id: 'd1', ticketId: 't1', kind: 'plan_approval', title: 'Approve the plan', context: 'ctx',
        optionsJson: [{ key: 'approve', label: 'Approve' }], recommendation: 'approve',
        correlationKey: 'plan_approval:t1', targetJson: { changeName: 'vs-1-dark-mode' },
      });
      insertDecision(before, {
        id: 'd2', ticketId: 't1', kind: 'merge_approval', title: 'Merge?', status: 'answered',
        answerKey: 'merge', answerText: 'go ahead', answeredByKind: 'human', answeredAt: 't2',
      });
      insertDecision(before, { id: 'd3', ticketId: null, kind: 'gate_finding', owner: 'conductor', title: 'Three empty turns' });
      expect(() => insertDecision(before, { id: 'd0', kind: 'retry_approval', title: 'Parked' })).toThrow(/CHECK constraint failed/);
      before.close();

      const db = openDb(path);
      expect(db.all('SELECT id FROM decisions').map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d1'])).toMatchObject({
        ticketId: 't1', kind: 'plan_approval', owner: 'human', status: 'open', context: 'ctx',
        options: [{ key: 'approve', label: 'Approve' }], recommendation: 'approve',
        correlationKey: 'plan_approval:t1', target: { changeName: 'vs-1-dark-mode' }, createdAt: 't1',
      });
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d2'])).toMatchObject({
        kind: 'merge_approval', status: 'answered', answerKey: 'merge', answerText: 'go ahead',
        answeredByKind: 'human', answeredAt: 't2',
      });
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d3'])).toMatchObject({ ticketId: null, kind: 'gate_finding', owner: 'conductor' });

      expect(db.all<{ name: string }>('PRAGMA index_list(decisions)').map((i) => i.name))
        .toEqual(expect.arrayContaining(['decisions_open_corr', 'decisions_ws_status']));
      expect(db.all<{ from: string; table: string }>('PRAGMA foreign_key_list(decisions)').map((f) => `${f.from}->${f.table}`).sort())
        .toEqual(['ticket_id->tickets', 'workspace_id->workspaces']);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);

      insertDecision(db, { id: 'd4', ticketId: 't1', kind: 'retry_approval', title: 'Parked', correlationKey: 'retry:a1' });
      expect(db.get<{ kind: string }>('SELECT kind FROM decisions WHERE id = ?', ['d4'])!.kind).toBe('retry_approval');
      db.close();

      const again = openDb(path);
      expect(again.all('SELECT id FROM decisions')).toHaveLength(4);
      expect(again.all("SELECT value FROM meta WHERE key = 'migration:0010_decision_kinds.sql'")).toHaveLength(1);
      again.close();
    });

    it('keeps the unique open-correlation index working after the rebuild', () => {
      const db = openDb(join(dir, 'h.sqlite'));
      seedTicket(db, { workspace: 'w1', ticket: 't1' });
      insertDecision(db, { id: 'd1', ticketId: 't1', kind: 'retry_approval', title: 'Parked', correlationKey: 'retry:a1' });
      expect(() => insertDecision(db, { id: 'd2', ticketId: 't1', kind: 'retry_approval', title: 'Parked again', correlationKey: 'retry:a1' }))
        .toThrow(/UNIQUE constraint failed/);
      db.close();
    });

    it('accepts every decision kind the system defines and refuses one it does not', () => {
      const db = openDb(join(dir, 'i.sqlite'));
      seedTicket(db, { workspace: 'w1', ticket: 't1' });
      for (const kind of DECISION_KINDS) insertDecision(db, { id: `d-${kind}`, ticketId: 't1', kind, title: kind });
      expect(db.all<{ kind: string }>('SELECT kind FROM decisions').map((r) => r.kind).sort()).toEqual([...DECISION_KINDS].sort());
      expect(() => insertDecision(db, { id: 'dx', ticketId: 't1', kind: 'plan_aproval', title: 'typo' })).toThrow(/CHECK constraint failed/);
      db.close();
    });

    // The omission this migration fixes was a kind added to DECISION_KINDS with no migration behind
    // it. Set equality both ways, so a kind dropped from the enum fails here too.
    it('keeps the persisted kind CHECK and DECISION_KINDS in step', () => {
      const db = openDb(join(dir, 'j.sqlite'));
      expect(persistedDecisionKinds(db).sort()).toEqual([...DECISION_KINDS].sort());
      db.close();
    });
  });
});
