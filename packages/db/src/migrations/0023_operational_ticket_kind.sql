-- ac:foreign_keys_off
-- VS-216. SQLite cannot ALTER a CHECK. `tickets.kind` must accept `operational`, and
-- `decisions.kind` must accept `action_approval`. `tickets` is a referenced table — unlike
-- 0010/0018, which only rebuilt the leaf `decisions` — so this file opts into
-- `Db.migrate()`'s `-- ac:foreign_keys_off` (FK off before BEGIN, restored after COMMIT
-- and on rollback). Child FK clauses are left alone: with FK off, DROP succeeds, and
-- RENAME puts the name `tickets` back so those clauses still resolve.
--
-- Column order is today's: 0001 then every ADD COLUMN in file order
-- (created_run_id, merge_queued_at, merge_started_at, interactive_session,
-- blocked_from_status, landing_branch, summary, worker_model_id). Only the kind CHECK
-- changes. `parent_id TEXT REFERENCES tickets(id)` is written that way; INSERT copies
-- the values. Do not rewrite child FK clauses.

CREATE TABLE tickets_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT REFERENCES projects(id), number INTEGER NOT NULL,
  identifier TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('change','task','scout','question','operational')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog','todo','proposing','proposed','approved','in_progress','in_review','merging','blocked','done','cancelled')) DEFAULT 'backlog',
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium', auto_merge INTEGER NOT NULL DEFAULT 0,
  assignee_role_id TEXT REFERENCES roles(id), worker_id TEXT, assignee_human INTEGER NOT NULL DEFAULT 0, parent_id TEXT REFERENCES tickets(id),
  created_by_kind TEXT NOT NULL, created_by_id TEXT, origin_kind TEXT, origin_fingerprint TEXT, checkout_run_id TEXT, execution_run_id TEXT,
  execution_locked_at TEXT, openspec_change_name TEXT, openspec_state_json TEXT, delivery_json TEXT, unblock_json TEXT, monitor_next_check_at TEXT,
  blocked_transition_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  created_run_id TEXT, merge_queued_at TEXT, merge_started_at TEXT,
  interactive_session INTEGER NOT NULL DEFAULT 0, blocked_from_status TEXT, landing_branch TEXT, summary TEXT, worker_model_id TEXT,
  UNIQUE (workspace_id, number)
);
INSERT INTO tickets_new SELECT * FROM tickets;
DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_origin_open ON tickets(workspace_id, origin_kind, origin_fingerprint) WHERE origin_fingerprint IS NOT NULL AND status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS tickets_ws_status ON tickets(workspace_id, status);
CREATE INDEX IF NOT EXISTS tickets_project ON tickets(project_id, status);
CREATE INDEX IF NOT EXISTS tickets_merge_queue ON tickets(project_id, merge_queued_at);

-- Same leaf rebuild as 0018, plus `action_approval`. Column list is 0018's (id through
-- answer_inputs_json). Keep it byte-for-byte in today's order so INSERT … SELECT * matches
-- by position.
CREATE TABLE decisions_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','concern','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval','retry_approval','action_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','conductor')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), inputs_json TEXT NOT NULL DEFAULT '[]', answer_inputs_json TEXT
);
INSERT INTO decisions_new SELECT * FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);
CREATE INDEX IF NOT EXISTS decisions_ws_project ON decisions(workspace_id, project_id);
