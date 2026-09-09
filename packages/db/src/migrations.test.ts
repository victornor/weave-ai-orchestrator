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

  it('adds tickets.summary without a default (VS-146)', () => {
    const db = openDb(join(dir, 'summary.sqlite'));
    expect(columns(db)).toContain('summary');
    seedTicket(db, { workspace: 'ws1', ticket: 't1' });
    expect(db.get<{ summary: string | null }>('SELECT summary FROM tickets WHERE id = ?', ['t1'])!.summary).toBeNull();
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
});
