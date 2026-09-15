import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECISION_KINDS, TICKET_KINDS } from '@weave-ai/shared';
import { openDb } from './repos.js';
import { Db, migrationWantsForeignKeysOff } from './db.js';

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
function persistedKindCheck(db: Db, table: string): string[] {
  const ddl = db.get<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, [table])!.sql;
  const clause = /kind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(ddl);
  if (!clause) throw new Error(`no kind CHECK found in: ${ddl}`);
  return clause[1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
}

function persistedDecisionKinds(db: Db): string[] {
  return persistedKindCheck(db, 'decisions');
}

function persistedTicketKinds(db: Db): string[] {
  return persistedKindCheck(db, 'tickets');
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

  it('adds tickets.merge_bypasses with a zero default (VS-390)', () => {
    const db = openDb(join(dir, 'bypasses.sqlite'));
    expect(columns(db)).toContain('merge_bypasses');
    seedTicket(db, { workspace: 'ws1', ticket: 't1' });
    expect(db.get<{ mergeBypasses: number }>('SELECT merge_bypasses FROM tickets WHERE id = ?', ['t1'])!.mergeBypasses).toBe(0);
    db.close();
  });

  it('adds tickets.summary without a default (VS-146)', () => {
    const db = openDb(join(dir, 'summary.sqlite'));
    expect(columns(db)).toContain('summary');
    seedTicket(db, { workspace: 'ws1', ticket: 't1' });
    expect(db.get<{ summary: string | null }>('SELECT summary FROM tickets WHERE id = ?', ['t1'])!.summary).toBeNull();
    db.close();
  });

  it('adds tickets.worker_model_id without a default (VS-162)', () => {
    const db = openDb(join(dir, 'worker-model.sqlite'));
    expect(columns(db)).toContain('worker_model_id');
    seedTicket(db, { workspace: 'ws1', ticket: 't1' });
    expect(db.get<{ workerModelId: string | null }>('SELECT worker_model_id FROM tickets WHERE id = ?', ['t1'])!.workerModelId).toBeNull();
    db.close();
  });

  // VS-56: why a paused worker stopped, structured. Additive and backfill-free — every worker that
  // predates it keeps its free-text `pause_reason` and gains a null detail.
  describe('the agent pause detail', () => {
    const agentColumns = (db: Db): string[] => db.all<{ name: string }>('PRAGMA table_info(agents)').map((c) => c.name);

    it('adds the column and preserves every worker that predates it', () => {
      const path = join(dir, 'pause.sqlite');
      const before = openDbAsOf(path, '0010_decision_kinds.sql');
      seedTicket(before, { workspace: 'ws1', ticket: 't1' });
      expect(agentColumns(before)).not.toContain('pause_detail_json');
      const seed = (id: string, status: string, pauseReason: string | null): void => {
        before.run(
          `INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, pause_reason, home_path, created_at, updated_at)
           VALUES (?, 'ws1', 'worker', ?, 'claude', ?, ?, '/tmp/h', 't0', 't0')`, [id, id, status, pauseReason]);
      };
      seed('a_active', 'active', null);
      seed('a_paused', 'paused', 'rate_limit: waiting for a human');
      seed('a_retired', 'retired', null);
      before.close();

      const db = openDb(path);
      expect(agentColumns(db)).toContain('pause_detail_json');
      const rows = db.all<{ id: string; status: string; pauseReason: string | null; pauseDetail: unknown }>(
        'SELECT id, status, pause_reason, pause_detail_json FROM agents ORDER BY id');
      expect(rows.map((r) => r.id)).toEqual(['a_active', 'a_paused', 'a_retired']);
      expect(rows.map((r) => r.status)).toEqual(['active', 'paused', 'retired']);
      expect(rows[1]!.pauseReason).toBe('rate_limit: waiting for a human');
      expect(rows.every((r) => r.pauseDetail === null)).toBe(true);
      expect(db.all('PRAGMA foreign_key_check')).toHaveLength(0);
      db.close();
    });

    it('applies once and leaves its meta row alone on reopen', () => {
      const path = join(dir, 'pause-again.sqlite');
      const first = openDb(path);
      const before = agentColumns(first);
      first.close();
      const second = openDb(path);
      expect(agentColumns(second)).toEqual(before);
      expect(second.all<{ value: string }>("SELECT value FROM meta WHERE key = 'migration:0011_agent_pause_detail.sql'")).toHaveLength(1);
      second.close();
    });
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
      'log_json', 'backups_json', 'came_back_version', 'announced_at', 'drained_runs', 'interrupted_runs',
      'migration_outcome',
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
      // owner: 'conductor' is 0027's (VS-259) rename target; openDb runs every migration, so d3
      // reads back owner: 'weaver' below.
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
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d3'])).toMatchObject({ ticketId: null, kind: 'gate_finding', owner: 'weaver' });

      expect(db.all<{ name: string }>('PRAGMA index_list(decisions)').map((i) => i.name))
        .toEqual(expect.arrayContaining(['decisions_open_corr', 'decisions_ws_status']));
      // Containment, not equality: this is 0010's invariant — the rebuild kept the references it
      // had — and a later migration adding a column with one of its own does not violate it.
      expect(db.all<{ from: string; table: string }>('PRAGMA foreign_key_list(decisions)').map((f) => `${f.from}->${f.table}`).sort())
        .toEqual(expect.arrayContaining(['ticket_id->tickets', 'workspace_id->workspaces']));
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

  describe('0011_activity_project', () => {
    /**
     * The history a workspace already has when this migration runs: activity rows recorded before the
     * column existed, one per way a row can reach a project (through its ticket, through its role,
     * through the project itself) plus two that reach none.
     */
    function seedHistory(db: Db): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 2, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, runtime_id, created_at, updated_at)
         VALUES ('p1', 'w1', 'app', 'App', 'https://example.invalid/app', '/tmp/app', 'claude', 't0', 't0')`);
      db.run(
        `INSERT INTO roles (id, workspace_id, project_id, slug, name, charter_summary, scope_text, runtime_id, created_at, updated_at)
         VALUES ('r1', 'w1', 'p1', 'engineer', 'Engineer', 'Owns the app', 'The app', 'claude', 't0', 't0')`);
      db.run(
        `INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 'p1', 1, 'VS-1', 'change', 'Add dark mode', 'human', 't0', 't0')`);
      // A workspace-level ticket: no project, so nothing to backfill from.
      db.run(
        `INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t2', 'w1', NULL, 2, 'VS-2', 'task', 'Tidy the workspace', 'human', 't0', 't0')`);

      const activity = (id: string, action: string, entityType: string, entityId: string, ticketId: string | null) =>
        db.run(
          `INSERT INTO activity (id, workspace_id, actor_kind, actor_id, action, entity_type, entity_id, ticket_id, details_json, created_at)
           VALUES (?, 'w1', 'human', 'victor', ?, ?, ?, ?, '{}', 't1')`, [id, action, entityType, entityId, ticketId]);
      activity('a1', 'ticket.create', 'ticket', 't1', 't1');
      activity('a2', 'role.hire', 'role', 'r1', null);
      activity('a3', 'project.add', 'project', 'p1', null);
      activity('a4', 'ticket.create', 'ticket', 't2', 't2');
      activity('a5', 'wake.enqueue', 'wakeup', 'w-1', null);
    }

    const projectOf = (db: Db, id: string) =>
      db.get<{ projectId: string | null }>('SELECT project_id FROM activity WHERE id = ?', [id])!.projectId;

    it('backfills the project of history recorded before the column existed', () => {
      const path = join(dir, 'k.sqlite');
      const before = openDbAsOf(path, '0010_decision_kinds.sql');
      seedHistory(before);
      expect(before.all<{ name: string }>('PRAGMA table_info(activity)').map((c) => c.name)).not.toContain('project_id');
      before.close();

      const db = openDb(path);
      expect(projectOf(db, 'a1')).toBe('p1');   // through its ticket
      expect(projectOf(db, 'a2')).toBe('p1');   // through its role
      expect(projectOf(db, 'a3')).toBe('p1');   // the project itself
      expect(projectOf(db, 'a4')).toBeNull();   // a ticket with no project
      expect(projectOf(db, 'a5')).toBeNull();   // reaches nothing with a project
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });

    it('leaves a row whose project has since been removed unattached', () => {
      const path = join(dir, 'l.sqlite');
      const before = openDbAsOf(path, '0010_decision_kinds.sql');
      seedHistory(before);
      before.run(
        `INSERT INTO activity (id, workspace_id, actor_kind, actor_id, action, entity_type, entity_id, ticket_id, details_json, created_at)
         VALUES ('a6', 'w1', 'human', 'victor', 'project.remove', 'project', 'p-gone', NULL, '{}', 't1')`);
      before.close();

      const db = openDb(path);
      expect(projectOf(db, 'a6')).toBeNull();
      db.close();
    });

    it('indexes the changelog scans and stays a no-op on a second run', () => {
      const path = join(dir, 'm.sqlite');
      const db = openDb(path);
      expect(db.all<{ name: string }>('PRAGMA index_list(activity)').map((i) => i.name))
        .toEqual(expect.arrayContaining(['activity_changelog', 'activity_changelog_project']));
      db.close();

      const again = openDb(path);
      expect(again.all("SELECT value FROM meta WHERE key = 'migration:0011_activity_project.sql'")).toHaveLength(1);
      again.close();
    });
  });
  // VS-77: model selection becomes two per-workspace settings, so every column that could override
  // them is dropped. One-way, and the rows themselves survive untouched.
  describe('the model override columns', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    const seedOverrides = (db: Db): void => {
      seedTicket(db, { workspace: 'ws1', ticket: 't1' });
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, runtime_id, model, created_at, updated_at)
         VALUES ('p1', 'ws1', 'api', 'API', 'git@example.com:a/api.git', '/tmp/api', 'codex', 'gpt-5', 't0', 't0')`);
      db.run(
        `INSERT INTO roles (id, workspace_id, project_id, slug, name, charter_summary, scope_text, runtime_id, model, effort, max_workers, created_at, updated_at)
         VALUES ('r1', 'ws1', 'p1', 'backend', 'Backend Engineer', 'Owns the API', 'The api repo', 'codex', 'gpt-5', 'high', 3, 't0', 't0')`);
      db.run(
        `INSERT INTO agents (id, workspace_id, kind, project_id, role_id, ticket_id, name, runtime_id, model, effort, home_path, turn_count, created_at, updated_at)
         VALUES ('a1', 'ws1', 'worker', 'p1', 'r1', 't1', 'Backend Engineer #1', 'codex', 'gpt-5', 'high', '/tmp/a1', 7, 't0', 't0')`);
    };

    it('drops the overrides and keeps every other value on the row', () => {
      const path = join(dir, 'models.sqlite');
      const before = openDbAsOf(path, '0011_agent_pause_detail.sql');
      seedOverrides(before);
      expect(cols(before, 'roles')).toEqual(expect.arrayContaining(['runtime_id', 'model', 'effort']));
      before.close();

      const db = openDb(path);
      for (const c of ['runtime_id', 'model']) expect(cols(db, 'projects')).not.toContain(c);
      for (const c of ['runtime_id', 'model', 'effort']) expect(cols(db, 'roles')).not.toContain(c);
      for (const c of ['model', 'effort']) expect(cols(db, 'agents')).not.toContain(c);

      expect(db.get('SELECT slug, max_workers FROM roles WHERE id = ?', ['r1'])).toMatchObject({ slug: 'backend', maxWorkers: 3 });
      expect(db.get('SELECT slug, clone_path FROM projects WHERE id = ?', ['p1'])).toMatchObject({ slug: 'api', clonePath: '/tmp/api' });
      // The agent keeps the runtime it is on: a record of what it runs, never an override.
      expect(db.get('SELECT runtime_id, turn_count FROM agents WHERE id = ?', ['a1'])).toMatchObject({ runtimeId: 'codex', turnCount: 7 });
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });

    it('leaves what records a real run alone', () => {
      const db = openDb(join(dir, 'kept.sqlite'));
      expect(cols(db, 'runs')).toEqual(expect.arrayContaining(['runtime_id', 'model']));
      expect(cols(db, 'agent_sessions')).toContain('runtime_id');
      expect(cols(db, 'usage_events')).toEqual(expect.arrayContaining(['runtime_id', 'model']));
      db.close();
    });

    it('is a no-op on a second open', () => {
      const path = join(dir, 'twice.sqlite');
      const db = openDb(path);
      db.close();
      const again = openDb(path);
      expect(again.all("SELECT value FROM meta WHERE key = 'migration:0012_model_settings.sql'")).toHaveLength(1);
      expect(again.all<{ name: string }>('PRAGMA table_info(roles)').map((c) => c.name)).not.toContain('runtime_id');
      again.close();
    });
  });
  describe('0013_decision_project_inputs', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    it('backfills project_id from the ticket and defaults the input columns', () => {
      const path = join(dir, 'dpi.sqlite');
      const before = openDbAsOf(path, '0012_upgrade_announcement.sql');
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      before.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at)
         VALUES ('p1', 'w1', 'api', 'API', 'git@e:a/b.git', 'main', '/tmp/p', 4, 'git', 1, '{}', 'ready', 't0', 't0')`);
      before.run(
        `INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 'p1', 1, 'VS-1', 'change', 'Add dark mode', 'human', 't0', 't0')`);
      expect(cols(before, 'decisions')).not.toContain('project_id');
      const seed = (id: string, ticketId: string | null): void => {
        before.run(
          `INSERT INTO decisions (id, workspace_id, ticket_id, kind, owner, title, status, created_at)
           VALUES (?, 'w1', ?, 'question', 'human', 'Which one?', 'open', 't1')`, [id, ticketId]);
      };
      seed('d_ticket', 't1');
      seed('d_workspace', null);
      before.close();

      const db = openDb(path);
      expect(cols(db, 'decisions')).toEqual(expect.arrayContaining(['project_id', 'inputs_json', 'answer_inputs_json']));
      // The ticket's project is where every decision raised before this migration got its project.
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d_ticket'])).toMatchObject({ projectId: 'p1', inputs: [], answerInputs: null });
      // A workspace-wide question stays null, which is the honest answer for it.
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d_workspace'])).toMatchObject({ projectId: null, inputs: [] });
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });

    it('round-trips the input columns as JSON', () => {
      const db = openDb(join(dir, 'dpi2.sqlite'));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('decisions', {
        id: 'd1', workspaceId: 'w1', kind: 'question', owner: 'human', title: 'Keys?', status: 'answered', createdAt: 't1',
        inputsJson: [{ key: 'regions', label: 'Regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }] }],
        answerInputsJson: { regions: ['eu'], token: 'CF_READONLY_TOKEN' },
      });
      const row = db.get<{ inputs: Array<{ key: string }>; answerInputs: Record<string, unknown> }>('SELECT * FROM decisions WHERE id = ?', ['d1']);
      expect(row?.inputs[0]?.key).toBe('regions');
      expect(row?.answerInputs).toEqual({ regions: ['eu'], token: 'CF_READONLY_TOKEN' });
      db.close();
    });
  });

  describe('0015_ticket_interactive_session', () => {
    it('adds interactive_session defaulting to 0, with no CHECK or FK', () => {
      const db = openDb(join(dir, 'tis1.sqlite'));
      const cols = db.all<{ name: string }>('PRAGMA table_info(tickets)').map((c) => c.name);
      expect(cols).toContain('interactive_session');
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('tickets', {
        id: 't1', workspaceId: 'w1', number: 1, identifier: 'VS-1', kind: 'task', title: 'x',
        createdByKind: 'human', createdAt: 't0', updatedAt: 't0',
      });
      const row = db.get<{ interactiveSession: number }>('SELECT * FROM tickets WHERE id = ?', ['t1'])!;
      expect(row.interactiveSession).toBe(0);
      db.close();
    });

    it('migrates an existing database with real ticket rows cleanly', () => {
      const db = openDbAsOf(join(dir, 'tis2.sqlite'), '0014_knowledge_provenance.sql');
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 1, 'VS-1', 'task', 'Add dark mode', 'human', 't0', 't0')`);
      db.close();
      const reopened = openDb(join(dir, 'tis2.sqlite'));
      const row = reopened.get<{ interactiveSession: number }>('SELECT * FROM tickets WHERE id = ?', ['t1'])!;
      expect(row.interactiveSession).toBe(0);
      reopened.close();
    });
  });

  describe('0019_project_sync_state', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    const seedProject = (db: Db, id: string): void => {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at)
         VALUES (?, 'w1', ?, 'API', 'git@e:a/b.git', 'main', '/tmp/p', 4, 'git', 1, '{}', 'ready', 't0', 't0')`, [id, id]);
    };

    it('defaults every existing project row to in_sync', () => {
      const path = join(dir, 'sync1.sqlite');
      const before = openDbAsOf(path, '0018_decision_concern_kind.sql');
      expect(cols(before, 'projects')).not.toContain('sync_state');
      seedProject(before, 'p1');
      before.close();

      const db = openDb(path);
      expect(db.get<{ syncState: string }>('SELECT sync_state FROM projects WHERE id = ?', ['p1'])!.syncState).toBe('in_sync');
      db.close();
    });

    it('accepts behind and diverged, and refuses anything else', () => {
      const db = openDb(join(dir, 'sync2.sqlite'));
      seedProject(db, 'p1');
      db.run("UPDATE projects SET sync_state = 'behind' WHERE id = 'p1'");
      db.run("UPDATE projects SET sync_state = 'diverged' WHERE id = 'p1'");
      expect(() => db.run("UPDATE projects SET sync_state = 'ahead' WHERE id = 'p1'")).toThrow(/CHECK constraint failed/);
      db.close();
    });
  });

  describe('0020_thread_message_idempotency_key', () => {
    const cols = (db: Db): string[] => db.all<{ name: string }>('PRAGMA table_info(thread_messages)').map((c) => c.name);

    function seedMessage(db: Db, id: string, key: string | null): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(`INSERT INTO channels (id, workspace_id, kind, config_json, status) VALUES ('c1', 'w1', 'web', '{}', 'active')`);
      db.run(`INSERT INTO channel_threads (id, channel_id, agent_id, is_primary, created_at) VALUES ('th1', 'c1', 'a1', 1, 't0')`);
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at${key !== null ? ', idempotency_key' : ''})
         VALUES (?, 'th1', 'inbound', 'human', 'hi', 't0'${key !== null ? ', ?' : ''})`,
        key !== null ? [id, key] : [id],
      );
    }

    it('adds the column and a unique index that ignores nulls', () => {
      const path = join(dir, 'idem1.sqlite');
      const before = openDbAsOf(path, '0019_telegram_pending_users.sql');
      expect(cols(before)).not.toContain('idempotency_key');
      seedMessage(before, 'm1', null);
      before.close();

      const db = openDb(path);
      expect(cols(db)).toContain('idempotency_key');
      expect(db.all<{ name: string }>('PRAGMA index_list(thread_messages)').map((i) => i.name))
        .toContain('thread_messages_idempotency');
      expect(db.get<{ idempotencyKey: string | null }>('SELECT idempotency_key FROM thread_messages WHERE id = ?', ['m1'])!.idempotencyKey).toBeNull();
      db.close();
    });

    it('rejects a second row with the same key on the same thread, and allows two nulls', () => {
      const db = openDb(join(dir, 'idem2.sqlite'));
      seedMessage(db, 'm1', 'k1');
      expect(() => db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at, idempotency_key)
         VALUES ('m2', 'th1', 'inbound', 'human', 'again', 't1', 'k1')`,
      )).toThrow(/UNIQUE constraint failed/);
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at)
         VALUES ('m3', 'th1', 'inbound', 'human', 'no key', 't2')`,
      );
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at)
         VALUES ('m4', 'th1', 'inbound', 'human', 'also no key', 't3')`,
      );
      expect(db.all('SELECT id FROM thread_messages')).toHaveLength(3);
      db.close();
    });
  });

  describe('0042_thread_message_replies (VS-449)', () => {
    function seedReplyThread(db: Db): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(`INSERT INTO channels (id, workspace_id, kind, config_json, status) VALUES ('c1', 'w1', 'web', '{}', 'active')`);
      db.run(`INSERT INTO channel_threads (id, channel_id, agent_id, is_primary, created_at) VALUES ('th1', 'c1', 'a1', 1, 't0')`);
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at)
         VALUES ('asked', 'th1', 'outbound', 'agent', 'which one?', 't0')`);
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at, reply_to_message_id)
         VALUES ('answered', 'th1', 'inbound', 'human', 'that one', 't1', 'asked')`);
    }

    it('creates the table and backfills every existing single-target reply', () => {
      const path = join(dir, 'replies1.sqlite');
      const before = openDbAsOf(path, '0041_plan_drafts.sql');
      expect(before.all<{ name: string }>('PRAGMA table_info(thread_message_replies)')).toEqual([]);
      seedReplyThread(before);
      before.close();

      const db = openDb(path);
      expect(db.all('SELECT * FROM thread_message_replies')).toEqual([
        { messageId: 'answered', repliedToMessageId: 'asked', createdAt: 't1' },
      ]);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });

    it('refuses a duplicate pair and a link to a message that does not exist', () => {
      const db = openDb(join(dir, 'replies2.sqlite'));
      seedReplyThread(db);
      db.run(`INSERT INTO thread_message_replies (message_id, replied_to_message_id, created_at) VALUES ('answered', 'asked', 't1')`);
      expect(() => db.run(
        `INSERT INTO thread_message_replies (message_id, replied_to_message_id, created_at) VALUES ('answered', 'asked', 't2')`,
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => db.run(
        `INSERT INTO thread_message_replies (message_id, replied_to_message_id, created_at) VALUES ('answered', 'ghost', 't2')`,
      )).toThrow(/FOREIGN KEY constraint failed/);
      db.close();
    });

    it('indexes the reverse lookup and is a no-op on a second open', () => {
      const path = join(dir, 'replies3.sqlite');
      const db = openDb(path);
      expect(db.all<{ name: string }>('PRAGMA index_list(thread_message_replies)').map((i) => i.name))
        .toContain('thread_message_replies_target');
      db.close();

      const again = openDb(path);
      expect(again.all("SELECT value FROM meta WHERE key = 'migration:0042_thread_message_replies.sql'")).toHaveLength(1);
      again.close();
    });
  });

  describe('0022_incidents', () => {
    it('creates the daemon-level incidents table with no foreign keys', () => {
      const db = openDbAsOf(join(dir, 'incidents.sqlite'), '0022_incidents.sql');
      const cols = db.all<{ name: string }>('PRAGMA table_info(incidents)').map((c) => c.name);
      expect(cols).toEqual([
        'id', 'reporter_kind', 'title', 'what_failed', 'trying_to_do', 'evidence',
        'workspace_id', 'project_id', 'ticket_id', 'agent_id', 'run_id', 'role_id', 'created_at',
      ]);
      expect(db.all<{ table: string }>('PRAGMA foreign_key_list(incidents)')).toHaveLength(0);
      expect(db.all<{ name: string }>('PRAGMA index_list(incidents)').map((i) => i.name)).toEqual(
        expect.arrayContaining(['incidents_created_at', 'incidents_reporter_kind']),
      );
      db.close();
    });

    it('round-trips an incident row', () => {
      const db = openDb(join(dir, 'incidents-row.sqlite'));
      db.insert('incidents', {
        id: 'i1', reporterKind: 'worker', title: 'MCP failed', whatFailed: 'weave_ticket_get',
        tryingToDo: 'read the ticket', evidence: 'not_found', workspaceId: 'ws1',
        agentId: 'ag1', runId: 'run1', createdAt: '2026-09-10T00:00:00.000Z',
      });
      const row = db.get<{ title: string; reporterKind: string; whatFailed: string }>('SELECT * FROM incidents WHERE id = ?', ['i1']);
      expect(row).toMatchObject({ title: 'MCP failed', reporterKind: 'worker', whatFailed: 'weave_ticket_get' });
      db.close();
    });
  });

  describe('0028_incident_resolution (VS-271)', () => {
    it('adds four nullable resolution columns with no foreign keys', () => {
      const db = openDb(join(dir, 'incidents-resolution.sqlite'));
      const cols = db.all<{ name: string }>('PRAGMA table_info(incidents)').map((c) => c.name);
      expect(cols).toEqual([
        'id', 'reporter_kind', 'title', 'what_failed', 'trying_to_do', 'evidence',
        'workspace_id', 'project_id', 'ticket_id', 'agent_id', 'run_id', 'role_id', 'created_at',
        'resolved_at', 'resolved_by_agent_id', 'resolution', 'resolution_ticket_id',
      ]);
      expect(db.all<{ table: string }>('PRAGMA foreign_key_list(incidents)')).toHaveLength(0);
      db.close();
    });

    it('a pre-existing incident starts unresolved (null resolvedAt) after the migration', () => {
      const before = openDbAsOf(join(dir, 'incidents-resolution-upgrade.sqlite'), '0022_incidents.sql');
      before.insert('incidents', {
        id: 'i1', reporterKind: 'worker', title: 'old incident', whatFailed: 'x', tryingToDo: 'y',
        agentId: 'ag1', runId: 'run1', createdAt: '2026-09-10T00:00:00.000Z',
      });
      before.close();

      const db = openDb(join(dir, 'incidents-resolution-upgrade.sqlite'));
      const row = db.get<{ resolvedAt: string | null; resolvedByAgentId: string | null; resolution: string | null; resolutionTicketId: string | null }>(
        'SELECT * FROM incidents WHERE id = ?', ['i1'],
      );
      expect(row).toMatchObject({ resolvedAt: null, resolvedByAgentId: null, resolution: null, resolutionTicketId: null });
      db.close();
    });

    it('round-trips a resolved incident', () => {
      const db = openDb(join(dir, 'incidents-resolution-row.sqlite'));
      db.insert('incidents', {
        id: 'i1', reporterKind: 'worker', title: 'MCP failed', whatFailed: 'x', tryingToDo: 'y',
        agentId: 'ag1', runId: 'run1', createdAt: '2026-09-10T00:00:00.000Z',
      });
      db.update('incidents', 'i1', {
        resolvedAt: '2026-09-12T00:00:00.000Z', resolvedByAgentId: 'weaver1',
        resolution: 'fixed by VS-232', resolutionTicketId: 'VS-232',
      });
      const row = db.get('SELECT * FROM incidents WHERE id = ?', ['i1']);
      expect(row).toMatchObject({
        resolvedAt: '2026-09-12T00:00:00.000Z', resolvedByAgentId: 'weaver1',
        resolution: 'fixed by VS-232', resolutionTicketId: 'VS-232',
      });
      db.close();
    });
  });

  describe('0023_operational_ticket_kind', () => {
    const TICKET_FK_CHILDREN = [
      'ticket_relations', 'ticket_comments', 'ticket_documents', 'ticket_work_products',
      'decisions', 'runs', 'knowledge_revisions',
    ] as const;

    function ticketsRefs(db: Db, table: string): string[] {
      return db.all<{ from: string; table: string }>(`PRAGMA foreign_key_list(${table})`)
        .filter((f) => f.table === 'tickets')
        .map((f) => f.from)
        .sort();
    }

    function seedReferencedRows(db: Db): void {
      seedTicket(db, { workspace: 'w1', ticket: 't-parent' });
      db.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, parent_id, created_by_kind, created_at, updated_at)
         VALUES ('t-child', 'w1', 2, 'VS-2', 'task', 'Child', 't-parent', 'human', 't0', 't0')`);
      db.run(
        `INSERT INTO ticket_relations (ticket_id, related_ticket_id, kind) VALUES ('t-child', 't-parent', 'blocks')`);
      db.run(
        `INSERT INTO ticket_comments (id, ticket_id, author_kind, body, created_at)
         VALUES ('c1', 't-parent', 'human', 'go', 't0')`);
      db.run(
        `INSERT INTO ticket_documents (id, ticket_id, key, current_revision) VALUES ('d1', 't-parent', 'report', 1)`);
      db.run(
        `INSERT INTO ticket_work_products (id, ticket_id, type, created_at, updated_at)
         VALUES ('wp1', 't-parent', 'report', 't0', 't0')`);
      db.insert('decisions', {
        id: 'dec1', workspaceId: 'w1', ticketId: 't-parent', kind: 'plan_approval', owner: 'human',
        title: 'Approve', status: 'open', createdAt: 't0',
      });
      db.run(
        `INSERT INTO agents (id, workspace_id, kind, name, runtime_id, home_path, created_at, updated_at)
         VALUES ('ag1', 'w1', 'worker', 'W', 'claude', '/tmp/h', 't0', 't0')`);
      db.run(
        `INSERT INTO runs (id, workspace_id, agent_id, ticket_id, wakeup_ids_json, runtime_id, turn_epoch, cwd, created_at)
         VALUES ('run1', 'w1', 'ag1', 't-parent', '[]', 'claude', 1, '/tmp', 't0')`);
      db.run(
        `INSERT INTO knowledge_files (id, workspace_id, path, scope, budget_tokens, hash, updated_at)
         VALUES ('kf1', 'w1', 'PROJECT.md', 'project', 10000, '', 't0')`);
      db.run(
        `INSERT INTO knowledge_revisions (id, file_id, revision, body, author_kind, reason, created_at, ticket_id)
         VALUES ('kr1', 'kf1', 1, 'body', 'agent', 'note', 't0', 't-parent')`);
    }

    it('opts in only when the first non-empty line is the marker', () => {
      expect(migrationWantsForeignKeysOff('-- ac:foreign_keys_off\nCREATE TABLE x (id TEXT);')).toBe(true);
      expect(migrationWantsForeignKeysOff('\n  -- ac:foreign_keys_off\nCREATE TABLE x (id TEXT);')).toBe(true);
      expect(migrationWantsForeignKeysOff('-- VS-216\n-- ac:foreign_keys_off\nCREATE TABLE x (id TEXT);')).toBe(false);
      expect(migrationWantsForeignKeysOff(readFileSync(join(MIGRATIONS_DIR, '0010_decision_kinds.sql'), 'utf8'))).toBe(false);
      expect(migrationWantsForeignKeysOff(readFileSync(join(MIGRATIONS_DIR, '0023_operational_ticket_kind.sql'), 'utf8'))).toBe(true);
    });

    it('rebuilds tickets and decisions while every FK child and parent_id pair survives', () => {
      const path = join(dir, 'op-kind.sqlite');
      const before = openDbAsOf(path, '0022_incidents.sql');
      expect(persistedTicketKinds(before)).not.toContain('operational');
      expect(persistedDecisionKinds(before)).not.toContain('action_approval');
      seedReferencedRows(before);
      before.close();

      const db = openDb(path);
      expect(db.get<{ parentId: string | null }>('SELECT parent_id FROM tickets WHERE id = ?', ['t-child'])!.parentId).toBe('t-parent');
      expect(db.all<{ id: string }>('SELECT id FROM tickets ORDER BY id').map((r) => r.id)).toEqual(['t-child', 't-parent']);
      expect(db.get('SELECT ticket_id FROM ticket_comments WHERE id = ?', ['c1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id FROM ticket_documents WHERE id = ?', ['d1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id FROM ticket_work_products WHERE id = ?', ['wp1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id FROM decisions WHERE id = ?', ['dec1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id FROM runs WHERE id = ?', ['run1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id FROM knowledge_revisions WHERE id = ?', ['kr1'])).toMatchObject({ ticketId: 't-parent' });
      expect(db.get('SELECT ticket_id, related_ticket_id FROM ticket_relations')).toMatchObject({
        ticketId: 't-child', relatedTicketId: 't-parent',
      });

      expect(ticketsRefs(db, 'tickets')).toEqual(['parent_id']);
      expect(ticketsRefs(db, 'ticket_relations')).toEqual(['related_ticket_id', 'ticket_id']);
      expect(ticketsRefs(db, 'ticket_comments')).toEqual(['ticket_id']);
      expect(ticketsRefs(db, 'ticket_documents')).toEqual(['ticket_id']);
      expect(ticketsRefs(db, 'ticket_work_products')).toEqual(['ticket_id']);
      expect(ticketsRefs(db, 'decisions')).toEqual(['ticket_id']);
      expect(ticketsRefs(db, 'runs')).toEqual(['ticket_id']);
      expect(ticketsRefs(db, 'knowledge_revisions')).toEqual(['ticket_id']);
      for (const table of TICKET_FK_CHILDREN) expect(ticketsRefs(db, table).length).toBeGreaterThan(0);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);

      expect(db.all<{ name: string }>('PRAGMA index_list(tickets)').map((i) => i.name)).toEqual(
        expect.arrayContaining(['tickets_origin_open', 'tickets_ws_status', 'tickets_project', 'tickets_merge_queue']),
      );
      expect(db.all<{ name: string }>('PRAGMA index_list(decisions)').map((i) => i.name)).toEqual(
        expect.arrayContaining(['decisions_open_corr', 'decisions_ws_status', 'decisions_ws_project']),
      );

      db.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t-op', 'w1', 3, 'VS-3', 'operational', 'Restart', 'human', 't0', 't0')`);
      expect(db.get<{ kind: string }>('SELECT kind FROM tickets WHERE id = ?', ['t-op'])!.kind).toBe('operational');
      expect(() => db.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t-typo', 'w1', 4, 'VS-4', 'operatonal', 'Typo', 'human', 't0', 't0')`,
      )).toThrow(/CHECK constraint failed/);

      db.insert('decisions', {
        id: 'dec-act', workspaceId: 'w1', ticketId: 't-op', kind: 'action_approval', owner: 'human',
        title: 'Approve the action', status: 'open', createdAt: 't0',
      });
      expect(db.get<{ kind: string }>('SELECT kind FROM decisions WHERE id = ?', ['dec-act'])!.kind).toBe('action_approval');
      expect(() => db.insert('decisions', {
        id: 'dec-typo', workspaceId: 'w1', ticketId: 't-op', kind: 'action_aproval', owner: 'human',
        title: 'Typo', status: 'open', createdAt: 't0',
      })).toThrow(/CHECK constraint failed/);

      expect(persistedTicketKinds(db).sort()).toEqual([...TICKET_KINDS].sort());
      expect(persistedDecisionKinds(db).sort()).toEqual([...DECISION_KINDS].sort());
      db.close();
    });

    it('keeps the persisted kind CHECKs equal to the TypeScript enums both ways', () => {
      const db = openDb(join(dir, 'op-kinds-enum.sqlite'));
      expect(persistedTicketKinds(db).sort()).toEqual([...TICKET_KINDS].sort());
      expect(persistedDecisionKinds(db).sort()).toEqual([...DECISION_KINDS].sort());
      db.close();
    });

    it('still cannot DROP TABLE tickets while a child row exists without the marker', () => {
      const path = join(dir, 'op-unmarked.sqlite');
      const db = openDbAsOf(path, '0022_incidents.sql');
      seedTicket(db, { workspace: 'w1', ticket: 't1' });
      db.run(
        `INSERT INTO ticket_comments (id, ticket_id, author_kind, body, created_at)
         VALUES ('c1', 't1', 'human', 'held', 't0')`);
      expect(() => db.sqlite.exec('DROP TABLE tickets')).toThrow(/FOREIGN KEY constraint failed/);
      expect(db.get('SELECT id FROM tickets WHERE id = ?', ['t1'])).toMatchObject({ id: 't1' });
      db.close();
    });
  });

  describe('0024_routines_engine (VS-220)', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    it('adds in_flight_wake_id and updated_at and can insert an active row', () => {
      const path = join(dir, 'routines-engine.sqlite');
      const before = openDbAsOf(path, '0023_operational_ticket_kind.sql');
      expect(cols(before, 'routines')).not.toContain('in_flight_wake_id');
      expect(cols(before, 'routines')).not.toContain('updated_at');
      before.close();

      const db = openDb(path);
      expect(cols(db, 'routines')).toEqual(expect.arrayContaining(['in_flight_wake_id', 'updated_at']));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO routines (id, workspace_id, name, trigger_json, template_json, status, next_fire_at, created_at, updated_at)
         VALUES ('r1', 'w1', 'Morning review', '{"kind":"schedule","timezone":"UTC","daily":{"hour":7,"minute":0}}', '{"instruction":"Look at incidents","action":"report","maxTicketsPerFire":0}', 'active', '2026-09-12T07:00:00.000Z', 't0', 't0')`);
      const row = db.get<{ name: string; status: string; inFlightWakeId: string | null; trigger: unknown; template: unknown }>(
        'SELECT name, status, in_flight_wake_id, trigger_json, template_json FROM routines WHERE id = ?', ['r1']);
      expect(row).toMatchObject({
        name: 'Morning review',
        status: 'active',
        inFlightWakeId: null,
        trigger: { kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } },
        template: { instruction: 'Look at incidents', action: 'report', maxTicketsPerFire: 0 },
      });
      db.close();
    });
  });

  describe('0025_decision_conductor_review (VS-223)', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    it('a pre-migration row survives and reads unseen with null timestamp/note/agent', () => {
      const path = join(dir, 'dcr.sqlite');
      const before = openDbAsOf(path, '0024_routines_engine.sql');
      expect(cols(before, 'decisions')).not.toContain('conductor_review_status');
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      before.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 1, 'VS-1', 'change', 'Add dark mode', 'human', 't0', 't0')`);
      before.run(
        `INSERT INTO decisions (id, workspace_id, ticket_id, kind, owner, title, status, created_at)
         VALUES ('d1', 'w1', 't1', 'plan_approval', 'human', 'Approve the plan', 'open', 't1')`);
      before.close();

      // 0027 (VS-259) later renames these four columns weaver_review_* in the same release; openDb
      // applies every migration, so the columns this row reads back through are the final names.
      const db = openDb(path);
      expect(cols(db, 'decisions')).toEqual(expect.arrayContaining([
        'weaver_review_status', 'weaver_reviewed_at', 'weaver_review_note', 'weaver_reviewed_by_agent_id',
      ]));
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d1'])).toMatchObject({
        weaverReviewStatus: 'unseen',
        weaverReviewedAt: null,
        weaverReviewNote: null,
        weaverReviewedByAgentId: null,
      });
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });

    it('round-trips the four fields on each carrying kind', () => {
      const db = openDb(join(dir, 'dcr2.sqlite'));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      for (const [id, kind] of [
        ['d_plan', 'plan_approval'],
        ['d_merge', 'merge_approval'],
        ['d_action', 'action_approval'],
      ] as const) {
        db.insert('decisions', {
          id, workspaceId: 'w1', kind, owner: 'human', title: kind, status: 'open', createdAt: 't1',
          weaverReviewStatus: 'concerns',
          weaverReviewedAt: '2026-09-11T03:00:00.000Z',
          weaverReviewNote: 'look at the migration',
          weaverReviewedByAgentId: 'ag_weaver',
        });
        expect(db.get('SELECT * FROM decisions WHERE id = ?', [id])).toMatchObject({
          kind,
          weaverReviewStatus: 'concerns',
          weaverReviewedAt: '2026-09-11T03:00:00.000Z',
          weaverReviewNote: 'look at the migration',
          weaverReviewedByAgentId: 'ag_weaver',
        });
      }
      db.close();
    });
  });

  describe('0026_agent_handovers (VS-249)', () => {
    function seedAgent(db: Db, id: string): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('agents', {
        id, workspaceId: 'w1', kind: 'worker', name: 'Backend Engineer #1', runtimeId: 'claude',
        status: 'active', homePath: '/tmp/home', turnEpoch: 0, turnCount: 0, spawnedBy: 'system',
        briefRevision: 1, createdAt: 't0', updatedAt: 't0',
      });
    }

    it('rejects a status outside active/returned/abandoned', () => {
      const db = openDb(join(dir, 'handovers1.sqlite'));
      seedAgent(db, 'a1');
      expect(() => db.insert('agent_handovers', {
        id: 'h1', agentId: 'a1', runtimeId: 'claude', startedAt: 't1', startedBy: 'victor',
        status: 'bogus', lastActivityAt: 't1', createdAt: 't1', updatedAt: 't1',
      })).toThrow();
      db.close();
    });

    it('round-trips an open hold and its later reconciliation', () => {
      const db = openDb(join(dir, 'handovers2.sqlite'));
      seedAgent(db, 'a1');
      db.insert('agent_handovers', {
        id: 'h1', agentId: 'a1', ticketId: 't1', runtimeId: 'claude',
        sessionRefJson: { sessionId: 'sess-1' }, worktreeHead: 'abc123', worktreeBranch: 'ac/vs-1-x',
        startedAt: '2026-09-11T10:00:00.000Z', startedBy: 'victor', status: 'active',
        lastActivitySignal: 'sig-0', lastActivityAt: '2026-09-11T10:00:00.000Z',
        createdAt: '2026-09-11T10:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z',
      });
      expect(db.get('SELECT * FROM agent_handovers WHERE id = ?', ['h1'])).toMatchObject({
        agentId: 'a1', ticketId: 't1', runtimeId: 'claude', sessionRef: { sessionId: 'sess-1' },
        worktreeHead: 'abc123', worktreeBranch: 'ac/vs-1-x', status: 'active',
        returnedAt: null, note: null, reconciliation: null,
      });
      db.update('agent_handovers', 'h1', {
        status: 'returned', returnedAt: '2026-09-11T11:00:00.000Z', note: 'debugged the device over USB',
        reconciliationJson: { newCommits: 2, dirty: false }, updatedAt: '2026-09-11T11:00:00.000Z',
      });
      expect(db.get('SELECT * FROM agent_handovers WHERE id = ?', ['h1'])).toMatchObject({
        status: 'returned', note: 'debugged the device over USB', reconciliation: { newCommits: 2, dirty: false },
      });
      db.close();
    });

    it('indexes by (agent_id, status) for the "does this agent have an open hold" lookup', () => {
      const db = openDb(join(dir, 'handovers3.sqlite'));
      const idx = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_handovers'");
      expect(idx.map((r) => r.name)).toContain('agent_handovers_agent_status');
      db.close();
    });
  });

  describe('0027_agent_kind_weaver (VS-259)', () => {
    /**
     * Every table this migration writes, scanned column by column, for a value the rebuild should
     * have already renamed. This is the migration's actual completion evidence (design.md Decision
     * 6) — the itemized rebuild list is a record of how, not proof of complete, and this repo has
     * already found two columns the itemized list first missed.
     */
    function scanForLiteralConductor(db: Db): string[] {
      const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
      const hits: string[] = [];
      for (const table of tables) {
        for (const col of db.all<{ name: string }>(`PRAGMA table_info(${table})`)) {
          const row = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${col.name}" = 'conductor'`);
          if (row && row.n > 0) hits.push(`${table}.${col.name} (${row.n})`);
        }
      }
      return hits;
    }

    it('rebuilds agents, decisions and roles while every existing row survives with its value renamed', () => {
      const path = join(dir, 'agent-kind.sqlite');
      const before = openDbAsOf(path, '0026_agent_handovers.sql');
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      before.run(
        `INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 1, 'VS-1', 'change', 'Rename to weaver', 'human', 't0', 't0')`);
      before.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, created_at, updated_at)
         VALUES ('p1', 'w1', 'p1', 'P1', 'git@x', '/tmp/p1', 't0', 't0')`,
      );
      before.insert('roles', {
        id: 'r1', workspaceId: 'w1', projectId: 'p1', slug: 'r1', name: 'R1', charterSummary: 'c', scopeText: 's',
        createdBy: 'conductor', createdAt: 't0', updatedAt: 't0',
      });
      before.insert('role_revisions', {
        id: 'rr1', roleId: 'r1', revision: 1, beforeJson: {}, afterJson: {}, author: 'conductor', createdAt: 't0',
      });
      before.insert('agents', {
        id: 'a1', workspaceId: 'w1', kind: 'conductor', name: 'Conductor', runtimeId: 'claude',
        homePath: '/tmp/conductor', createdAt: 't0', updatedAt: 't0',
      });
      before.insert('decisions', {
        id: 'd1', workspaceId: 'w1', ticketId: 't1', kind: 'plan_approval', owner: 'conductor', title: 'Approve',
        status: 'open', createdAt: 't0',
        conductorReviewStatus: 'concerns', conductorReviewedAt: 't0', conductorReviewNote: 'checked the migration',
        conductorReviewedByAgentId: 'a1',
      });
      // A row already using a value this migration does not touch — unaffected. spawnedBy:
      // 'conductor' (no CHECK — found by the column scan, same class of miss as
      // role_revisions.author) proves the agents rebuild also transforms that column, not only kind.
      before.insert('agents', {
        id: 'a-worker', workspaceId: 'w1', kind: 'worker', name: 'Worker', runtimeId: 'claude',
        homePath: '/tmp/worker', spawnedBy: 'conductor', createdAt: 't0', updatedAt: 't0',
      });
      before.close();

      const db = openDb(path);

      expect(db.get('SELECT id, kind FROM agents WHERE id = ?', ['a1'])).toMatchObject({ id: 'a1', kind: 'weaver' });
      expect(db.get('SELECT id, kind, spawned_by FROM agents WHERE id = ?', ['a-worker'])).toMatchObject({
        id: 'a-worker', kind: 'worker', spawnedBy: 'weaver',
      });
      expect(db.get('SELECT * FROM decisions WHERE id = ?', ['d1'])).toMatchObject({
        owner: 'weaver',
        weaverReviewStatus: 'concerns', weaverReviewedAt: 't0', weaverReviewNote: 'checked the migration',
        weaverReviewedByAgentId: 'a1',
      });
      expect(db.get('SELECT id, created_by FROM roles WHERE id = ?', ['r1'])).toMatchObject({ id: 'r1', createdBy: 'weaver' });
      expect(db.get('SELECT id, author FROM role_revisions WHERE id = ?', ['rr1'])).toMatchObject({ id: 'rr1', author: 'weaver' });

      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(scanForLiteralConductor(db)).toEqual([]);
      db.close();
    });

    it('renames incidents.reporter_kind, the column only daemon.sqlite ever populates', () => {
      // Simulates daemon.sqlite's shape: no workspace rows at all, only incidents — the one table
      // this migration touches that is empty in every *workspace* database (per 0022's own header)
      // but carries real rows at the daemon level (VS-259's plan review found 6 such rows live).
      const path = join(dir, 'daemon-shaped.sqlite');
      const before = openDbAsOf(path, '0026_agent_handovers.sql');
      before.insert('incidents', {
        id: 'i1', reporterKind: 'conductor', title: 'stuck', whatFailed: 'weave_ticket_get',
        tryingToDo: 'read the ticket', agentId: 'ag1', runId: 'run1', createdAt: 't0',
      });
      before.insert('incidents', {
        id: 'i2', reporterKind: 'worker', title: 'stuck too', whatFailed: 'weave_ticket_get',
        tryingToDo: 'read the ticket', agentId: 'ag2', runId: 'run2', createdAt: 't0',
      });
      before.close();

      const db = openDb(path);
      expect(db.get('SELECT id, reporter_kind FROM incidents WHERE id = ?', ['i1'])).toMatchObject({ id: 'i1', reporterKind: 'weaver' });
      expect(db.get('SELECT id, reporter_kind FROM incidents WHERE id = ?', ['i2'])).toMatchObject({ id: 'i2', reporterKind: 'worker' });
      expect(scanForLiteralConductor(db)).toEqual([]);
      db.close();
    });

    it('still enforces one weaver-kind agent per workspace after the rebuild', () => {
      const db = openDb(join(dir, 'one-weaver.sqlite'));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('agents', {
        id: 'a1', workspaceId: 'w1', kind: 'weaver', name: 'Weaver', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      expect(() => db.insert('agents', {
        id: 'a2', workspaceId: 'w1', kind: 'weaver', name: 'Second weaver', runtimeId: 'claude',
        homePath: '/tmp/weaver2', createdAt: 't0', updatedAt: 't0',
      })).toThrow(/UNIQUE constraint failed/);

      // A second worker-kind agent in the same workspace is unaffected.
      db.insert('agents', {
        id: 'a3', workspaceId: 'w1', kind: 'worker', name: 'Worker 1', runtimeId: 'claude',
        homePath: '/tmp/w1', createdAt: 't0', updatedAt: 't0',
      });
      db.insert('agents', {
        id: 'a4', workspaceId: 'w1', kind: 'worker', name: 'Worker 2', runtimeId: 'claude',
        homePath: '/tmp/w2', createdAt: 't0', updatedAt: 't0',
      });
      expect(db.all<{ id: string }>("SELECT id FROM agents WHERE kind = 'worker'").map((r) => r.id).sort()).toEqual(['a3', 'a4']);
      db.close();
    });

    it('a fresh workspace provisions its one agent of this kind as weaver', () => {
      const db = openDb(join(dir, 'fresh.sqlite'));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('agents', {
        id: 'a1', workspaceId: 'w1', kind: 'weaver', name: 'Weaver', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      expect(db.get('SELECT kind FROM agents WHERE id = ?', ['a1'])).toMatchObject({ kind: 'weaver' });
      db.close();
    });

    it('filtering agents by kind matches only the renamed value', () => {
      const db = openDb(join(dir, 'filter.sqlite'));
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.insert('agents', {
        id: 'a1', workspaceId: 'w1', kind: 'weaver', name: 'Weaver', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      expect(db.all("SELECT id FROM agents WHERE kind = 'weaver'")).toHaveLength(1);
      expect(db.all("SELECT id FROM agents WHERE kind = 'conductor'")).toHaveLength(0);
      db.close();
    });
  });

  describe('0032_upgrade_migration_outcome (VS-316)', () => {
    it('defaults to null and round-trips a value', () => {
      const db = openDb(join(dir, 'migration-outcome.sqlite'));
      db.insert('upgrades', {
        id: 'u1', state: 'queued', source: '/src', ref: 'main', requestedBy: 'operator',
        requestedAt: '2026-09-13T00:00:00.000Z', logJson: [], backupsJson: [],
      });
      expect(db.get<{ migrationOutcome: string | null }>('SELECT * FROM upgrades WHERE id = ?', ['u1'])?.migrationOutcome).toBeNull();
      db.update('upgrades', 'u1', { migrationOutcome: 'fallback' });
      expect(db.get<{ migrationOutcome: string | null }>('SELECT * FROM upgrades WHERE id = ?', ['u1'])?.migrationOutcome).toBe('fallback');
    });
  });

  describe('0034_rename_default_weaver_agent (VS-325)', () => {
    it('renames the untouched default weaver name and leaves a deliberate one alone', () => {
      const path = join(dir, 'weaver-name.sqlite');
      // A prefix just below the new file, so this stops before 0034 whatever migration happens to
      // precede it after other branches land (0032 and 0033 are claimed elsewhere).
      const before = openDbAsOf(path, '0033');
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w1', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`,
      );
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w2', 'w2', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`,
      );
      // The untouched default, in its own workspace because a workspace has one weaver.
      before.insert('agents', {
        id: 'a-default', workspaceId: 'w1', kind: 'weaver', name: 'Conductor', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      // A deliberately chosen name is not the default and must survive.
      before.insert('agents', {
        id: 'a-custom', workspaceId: 'w2', kind: 'weaver', name: 'Chief', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      // A worker whose name happens to be `Conductor` is not the weaver's default and is untouched.
      before.insert('agents', {
        id: 'a-worker', workspaceId: 'w1', kind: 'worker', name: 'Conductor', runtimeId: 'claude',
        homePath: '/tmp/worker', createdAt: 't0', updatedAt: 't0',
      });
      before.close();

      const db = openDb(path);
      expect(db.get('SELECT name FROM agents WHERE id = ?', ['a-default'])).toMatchObject({ name: 'Weaver' });
      expect(db.get('SELECT name FROM agents WHERE id = ?', ['a-custom'])).toMatchObject({ name: 'Chief' });
      expect(db.get('SELECT name FROM agents WHERE id = ?', ['a-worker'])).toMatchObject({ name: 'Conductor' });
      db.close();
    });
  });

  describe('0033_thread_message_search (VS-320)', () => {
    function seedThread(db: Db, workspaceId: string, threadId: string): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES (?, ?, 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`, [workspaceId, workspaceId]);
      db.run(`INSERT INTO channels (id, workspace_id, kind, config_json, status) VALUES (?, ?, 'web', '{}', 'active')`, [`c-${workspaceId}`, workspaceId]);
      db.run(`INSERT INTO channel_threads (id, channel_id, agent_id, is_primary, created_at) VALUES (?, ?, 'a1', 1, 't0')`, [threadId, `c-${workspaceId}`]);
    }

    function seedMessage(db: Db, id: string, threadId: string, body: string): void {
      db.run(
        `INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at) VALUES (?, ?, 'inbound', 'human', ?, 't0')`,
        [id, threadId, body],
      );
    }

    it('backfills every message already stored at migration time', () => {
      const path = join(dir, 'backfill.sqlite');
      const before = openDbAsOf(path, '0031_relayed_decision_answers.sql');
      seedThread(before, 'w1', 'th1');
      seedMessage(before, 'm1', 'th1', 'the deploy runs at midnight');
      before.close();

      const db = openDb(path);
      const rows = db.all<{ messageId: string; threadId: string; workspaceId: string }>(
        "SELECT message_id, thread_id, workspace_id FROM thread_message_search WHERE thread_message_search MATCH 'midnight'",
      );
      expect(rows).toEqual([{ messageId: 'm1', threadId: 'th1', workspaceId: 'w1' }]);
      db.close();
    });

    it('a fresh workspace has no rows to backfill and the table is still queryable', () => {
      const db = openDb(join(dir, 'fresh-search.sqlite'));
      seedThread(db, 'w1', 'th1');
      expect(db.all("SELECT * FROM thread_message_search")).toHaveLength(0);
      seedMessage(db, 'm1', 'th1', 'hello');
      // Backfill only ran once, at migration time — a message inserted afterward through raw SQL
      // (bypassing ThreadsService.insertMessage's own index-on-write) is not indexed by the table
      // alone, which is the behavior this test pins down before task 2.2 wires the write path.
      expect(db.all("SELECT * FROM thread_message_search")).toHaveLength(0);
      db.close();
    });
  });

  describe('0040_roadmap_items (VS-397)', () => {
    function seedProject(db: Db, id: string): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at)
         VALUES (?, 'w1', ?, 'API', 'git@e:a/b.git', 'main', '/tmp/p', 4, 'git', 1, '{}', 'ready', 't0', 't0')`, [id, id]);
    }

    const insertItem = (db: Db, id: string, projectId: string, over: Record<string, unknown> = {}) =>
      db.insert('roadmap_items', {
        id, projectId, title: 'Dark mode', notes: '', position: 0, status: 'idea',
        createdByKind: 'human', createdById: null, createdAt: 't0', updatedAt: 't0', ...over,
      });

    it('creates the table with its columns, index and foreign keys', () => {
      const db = openDb(join(dir, 'roadmap.sqlite'));
      expect(db.all<{ name: string }>('PRAGMA table_info(roadmap_items)').map((c) => c.name)).toEqual([
        'id', 'project_id', 'title', 'notes', 'position', 'status', 'ticket_id',
        'created_by_kind', 'created_by_id', 'created_at', 'updated_at',
      ]);
      expect(db.all<{ name: string }>('PRAGMA index_list(roadmap_items)').map((i) => i.name))
        .toContain('roadmap_items_project_position');
      expect(db.all<{ from: string; table: string }>('PRAGMA foreign_key_list(roadmap_items)').map((f) => `${f.from}->${f.table}`).sort())
        .toEqual(['project_id->projects', 'ticket_id->tickets']);
      expect(db.all<{ from: string; onDelete: string }>('PRAGMA foreign_key_list(roadmap_items)').map((f) => `${f.from}:${f.onDelete}`).sort())
        .toEqual(['project_id:CASCADE', 'ticket_id:SET NULL']);
      db.close();
    });

    it('round-trips an item and refuses an unknown status', () => {
      const db = openDb(join(dir, 'roadmap-row.sqlite'));
      seedProject(db, 'p1');
      insertItem(db, 'i1', 'p1', { notes: '## later', status: 'planned' });
      expect(db.get('SELECT * FROM roadmap_items WHERE id = ?', ['i1'])).toMatchObject({
        id: 'i1', projectId: 'p1', title: 'Dark mode', notes: '## later', position: 0, status: 'planned',
        createdByKind: 'human', createdById: null,
      });
      expect(() => insertItem(db, 'i2', 'p1', { status: 'someday' })).toThrow(/CHECK constraint failed/);
      db.close();
    });

    it('cascades on a hard project delete and links a ticket with SET NULL', () => {
      const db = openDb(join(dir, 'roadmap-cascade.sqlite'));
      seedProject(db, 'p1');
      db.run(
        `INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at)
         VALUES ('t1', 'w1', 'p1', 1, 'VS-1', 'change', 'Add dark mode', 'human', 't0', 't0')`);
      insertItem(db, 'i1', 'p1', { ticketId: 't1' });
      insertItem(db, 'i2', 'p1');
      // A soft archive keeps the project row and so keeps its roadmap.
      db.run("UPDATE projects SET status = 'archived' WHERE id = 'p1'");
      expect(db.all('SELECT id FROM roadmap_items ORDER BY id').map((r) => r.id)).toEqual(['i1', 'i2']);
      // Deleting the linked ticket nulls the link but keeps the item.
      db.run("DELETE FROM tickets WHERE id = 't1'");
      expect(db.get<{ ticketId: string | null }>('SELECT ticket_id FROM roadmap_items WHERE id = ?', ['i1'])!.ticketId).toBeNull();
      // A hard project delete takes every item with it, leaving no orphan.
      db.run("DELETE FROM projects WHERE id = 'p1'");
      expect(db.all('SELECT id FROM roadmap_items')).toHaveLength(0);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      db.close();
    });
  });

  describe('0041_plan_drafts (VS-398)', () => {
    const cols = (db: Db, table: string): string[] => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

    function seedPlanProject(db: Db, id: string): void {
      db.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at)
         VALUES (?, 'w1', ?, 'API', 'git@e:a/b.git', 'main', '/tmp/p', 4, 'git', 1, '{}', 'ready', 't0', 't0')`, [id, id]);
      db.run(`INSERT INTO channels (id, workspace_id, kind) VALUES ('c1', 'w1', 'web')`);
      db.run(`INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th1', 'c1', 'a-planner', 't0')`);
    }

    const insertPlan = (db: Db, id: string, projectId: string, over: Record<string, unknown> = {}) =>
      db.insert('plans', {
        id, workspaceId: 'w1', projectId, threadId: 'th1', title: 'Dark mode rollout',
        createdByKind: 'human', createdById: 'op1', createdAt: 't0', updatedAt: 't0', ...over,
      });

    const insertDraft = (db: Db, id: string, planId: string, over: Record<string, unknown> = {}) =>
      db.insert('plan_drafts', {
        id, planId, position: 0, title: 'Add token plumbing', description: '', kind: 'change',
        suggestedTier: 'standard', createdAt: 't0', updatedAt: 't0', ...over,
      });

    it('creates plans, plan_drafts and plan_draft_blockers with their columns and indexes', () => {
      const db = openDb(join(dir, 'plan-drafts.sqlite'));
      expect(cols(db, 'plans')).toEqual(expect.arrayContaining([
        'id', 'workspace_id', 'project_id', 'thread_id', 'agent_id', 'title', 'status',
        'created_by_kind', 'created_by_id', 'submitted_at', 'discarded_at', 'created_at', 'updated_at',
      ]));
      expect(cols(db, 'plan_drafts')).toEqual(expect.arrayContaining([
        'id', 'plan_id', 'position', 'title', 'description', 'kind', 'priority', 'target_role_id',
        'suggested_tier', 'tier_override', 'status', 'created_ticket_id', 'failure_reason', 'created_at', 'updated_at',
      ]));
      expect(cols(db, 'plan_draft_blockers')).toEqual(['plan_draft_id', 'blocks_on_draft_id']);
      const planIdx = db.all<{ name: string }>('PRAGMA index_list(plans)').map((i) => i.name);
      expect(planIdx).toContain('plans_one_drafting_per_project');
      const draftIdx = db.all<{ name: string }>('PRAGMA index_list(plan_drafts)').map((i) => i.name);
      expect(draftIdx).toContain('plan_drafts_plan_position');
      db.close();
    });

    it('round-trips a plan and a draft, and refuses an unknown draft kind or tier', () => {
      const db = openDb(join(dir, 'plan-round-trip.sqlite'));
      seedPlanProject(db, 'p1');
      insertPlan(db, 'pl1', 'p1');
      insertDraft(db, 'd1', 'pl1', { priority: 'high', suggestedTier: 'deep', tierOverride: 'standard' });
      expect(db.get('SELECT * FROM plans WHERE id = ?', ['pl1'])).toMatchObject({
        id: 'pl1', projectId: 'p1', threadId: 'th1', status: 'drafting', submittedAt: null, discardedAt: null,
      });
      expect(db.get('SELECT * FROM plan_drafts WHERE id = ?', ['d1'])).toMatchObject({
        id: 'd1', planId: 'pl1', kind: 'change', priority: 'high', suggestedTier: 'deep', tierOverride: 'standard',
        status: 'pending', createdTicketId: null, failureReason: null,
      });
      expect(() => insertDraft(db, 'd2', 'pl1', { kind: 'question' })).toThrow(/CHECK constraint failed/);
      expect(() => insertDraft(db, 'd3', 'pl1', { suggestedTier: 'urgent' })).toThrow(/CHECK constraint failed/);
      db.close();
    });

    it('allows only one drafting plan per project, but any number of submitted/discarded ones', () => {
      const db = openDb(join(dir, 'plan-one-drafting.sqlite'));
      seedPlanProject(db, 'p1');
      insertPlan(db, 'pl1', 'p1');
      expect(() => insertPlan(db, 'pl2', 'p1')).toThrow(/UNIQUE constraint failed/);
      insertPlan(db, 'pl2', 'p1', { status: 'submitted', submittedAt: 't1' });
      insertPlan(db, 'pl3', 'p1', { status: 'discarded', discardedAt: 't1' });
      expect(db.all<{ id: string }>('SELECT id FROM plans WHERE project_id = ?', ['p1']).map((r) => r.id).sort())
        .toEqual(['pl1', 'pl2', 'pl3']);
      db.close();
    });

    it('round-trips a plan_draft_blockers row and cascades it away when either draft is deleted', () => {
      const db = openDb(join(dir, 'plan-blockers.sqlite'));
      seedPlanProject(db, 'p1');
      insertPlan(db, 'pl1', 'p1');
      insertDraft(db, 'd1', 'pl1');
      insertDraft(db, 'd2', 'pl1', { position: 1 });
      db.run('INSERT INTO plan_draft_blockers (plan_draft_id, blocks_on_draft_id) VALUES (?, ?)', ['d2', 'd1']);
      expect(db.all('SELECT * FROM plan_draft_blockers')).toEqual([{ planDraftId: 'd2', blocksOnDraftId: 'd1' }]);
      db.run('DELETE FROM plan_drafts WHERE id = ?', ['d1']);
      expect(db.all('SELECT * FROM plan_draft_blockers')).toHaveLength(0);
      db.close();
    });

    it('widens agents.kind to include planner and adds agents.plan_id, without disturbing existing agents', () => {
      const path = join(dir, 'agents-planner.sqlite');
      const before = openDbAsOf(path, '0040_roadmap_items.sql');
      before.run(
        `INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
         VALUES ('w1', 'w', 'W', 'VS', 1, 'active', '/tmp/w', 't0', 't0')`);
      before.insert('agents', {
        id: 'a-weaver', workspaceId: 'w1', kind: 'weaver', name: 'Weaver', runtimeId: 'claude',
        homePath: '/tmp/weaver', createdAt: 't0', updatedAt: 't0',
      });
      before.insert('agents', {
        id: 'a-worker', workspaceId: 'w1', kind: 'worker', name: 'Worker', ticketId: 't1', runtimeId: 'claude',
        homePath: '/tmp/worker', createdAt: 't0', updatedAt: 't0',
      });
      before.close();

      const db = openDb(path);
      expect(cols(db, 'agents')).toContain('plan_id');
      expect(db.get('SELECT id, kind, plan_id FROM agents WHERE id = ?', ['a-weaver'])).toMatchObject({ id: 'a-weaver', kind: 'weaver', planId: null });
      expect(db.get('SELECT id, kind, ticket_id, plan_id FROM agents WHERE id = ?', ['a-worker']))
        .toMatchObject({ id: 'a-worker', kind: 'worker', ticketId: 't1', planId: null });
      expect(persistedKindCheck(db, 'agents')).toEqual(['weaver', 'worker', 'planner']);
      db.run(
        `INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, created_at, updated_at)
         VALUES ('p1', 'w1', 'p1', 'P1', 'git@x', '/tmp/p1', 't0', 't0')`,
      );
      db.run(`INSERT INTO channels (id, workspace_id, kind) VALUES ('c1', 'w1', 'web')`);
      db.run(`INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th1', 'c1', 'a-planner', 't0')`);
      insertPlan(db, 'pl1', 'p1');
      db.insert('agents', {
        id: 'a-planner', workspaceId: 'w1', kind: 'planner', planId: 'pl1', name: 'Planner', runtimeId: 'claude',
        homePath: '/tmp/planner', createdAt: 't0', updatedAt: 't0',
      });
      expect(db.get('SELECT id, kind, plan_id FROM agents WHERE id = ?', ['a-planner'])).toMatchObject({ id: 'a-planner', kind: 'planner', planId: 'pl1' });
      expect(() => db.insert('agents', {
        id: 'a-planner-2', workspaceId: 'w1', kind: 'planner', planId: 'pl1', name: 'Planner 2', runtimeId: 'claude',
        homePath: '/tmp/planner2', createdAt: 't0', updatedAt: 't0',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => db.insert('agents', {
        id: 'a-bad-kind', workspaceId: 'w1', kind: 'scheduler', name: 'Bad', runtimeId: 'claude',
        homePath: '/tmp/bad', createdAt: 't0', updatedAt: 't0',
      })).toThrow(/CHECK constraint failed/);
      db.close();
    });
  });
});
