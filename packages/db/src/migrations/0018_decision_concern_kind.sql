-- VS-127. `decisions.kind`'s CHECK was given eight values by 0010_decision_kinds.sql, but a ninth is
-- needed: `concern` is how a worker says "I'm stuck, here's what I tried, here's what would help"
-- without inventing options for a decision it isn't actually making (see
-- openspec/changes/vs-127-.../design.md). SQLite has no way to alter a CHECK, so the table is
-- rebuilt again, the same way 0010 did for `retry_approval`.
--
-- Same safety argument as 0010: `decisions` is still a leaf — nothing has a `REFERENCES decisions`
-- clause — so the rebuild has no children to orphan and the rename has no clauses elsewhere to
-- rewrite. Check that again before rebuilding this table a third time.
--
-- The column list is 0010's, plus `project_id` / `inputs_json` / `answer_inputs_json`, appended
-- since by 0013_decision_project_inputs.sql's plain `ALTER TABLE ADD COLUMN` (safe: 0010 already
-- rebuilt for its CHECK, so `INSERT … SELECT *` matching by position still lines up). Keep this
-- list byte-for-byte in the same order the columns exist in today, or the position-matched
-- `INSERT … SELECT *` below silently shuffles data into the wrong columns.
CREATE TABLE decisions_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','concern','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval','retry_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','conductor')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), inputs_json TEXT NOT NULL DEFAULT '[]', answer_inputs_json TEXT
);
INSERT INTO decisions_new SELECT * FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
-- Every index on the old table went with it.
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);
CREATE INDEX IF NOT EXISTS decisions_ws_project ON decisions(workspace_id, project_id);
