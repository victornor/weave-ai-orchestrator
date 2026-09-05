-- `decisions.kind` was given a literal seven-value CHECK in 0001_init.sql, but the system defines
-- eight: `retry_approval` is raised when a worker's automatic retries are spent, so the card that
-- offers the human retry / switch-runtime / cancel could never be stored (VS-49). SQLite has no way
-- to drop or replace a CHECK, so the table is rebuilt.
--
-- The rebuild runs with foreign keys ON: `PRAGMA foreign_keys` is a no-op inside a transaction and
-- Db.migrate() wraps every migration file in one, so the usual "turn foreign keys off and rebuild"
-- recipe is not available here. It is safe only because `decisions` is a leaf — nothing in the schema
-- has a `REFERENCES decisions` clause, so the drop has no children to orphan and the rename has no
-- clauses elsewhere to rewrite. Check that again before rebuilding this table a second time.
--
-- Keep the column list identical to 0001_init.sql apart from the `kind` CHECK: `INSERT … SELECT *`
-- below matches by position, and migrations.test.ts asserts the CHECK against DECISION_KINDS.
CREATE TABLE decisions_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval','retry_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','conductor')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL
);
INSERT INTO decisions_new SELECT * FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
-- Both indexes went with the old table.
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);
