-- ac:foreign_keys_off
-- VS-495. `agents.kind`'s CHECK gains `session`: a long-lived, per-role, no-ticket agent. Unlike
-- `planner` (0041), it needs no new column — `role_id` and `ticket_id` already exist and are exactly
-- what a session uses (role_id set at creation, ticket_id NULL until the human asks it to take a
-- ticket, cleared again once that ticket resolves). Same rebuild-and-copy treatment 0027/0041 used:
-- SQLite cannot ALTER a CHECK constraint. Column order and content otherwise unchanged since 0041.
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK (kind IN ('weaver','worker','planner','session')),
  project_id TEXT REFERENCES projects(id), role_id TEXT REFERENCES roles(id), role_revision INTEGER, ticket_id TEXT, plan_id TEXT REFERENCES plans(id), name TEXT NOT NULL,
  runtime_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('provisioning','active','running','paused','error','done','retired')) DEFAULT 'provisioning',
  pause_reason TEXT, error_text TEXT, home_path TEXT NOT NULL, worktree_path TEXT, branch TEXT, turn_epoch INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0, spawned_by TEXT NOT NULL DEFAULT 'system', spawn_reason TEXT, brief_revision INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, retired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pause_detail_json TEXT
);
INSERT INTO agents_new SELECT
  id, workspace_id, kind, project_id, role_id, role_revision, ticket_id, plan_id, name,
  runtime_id, status, pause_reason, error_text, home_path, worktree_path, branch, turn_epoch,
  turn_count, spawned_by, spawn_reason, brief_revision, last_run_at, retired_at, created_at, updated_at, pause_detail_json
FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_weaver ON agents(workspace_id) WHERE kind = 'weaver';
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_worker_per_ticket ON agents(ticket_id) WHERE kind = 'worker' AND status NOT IN ('retired');
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_planner_per_plan ON agents(plan_id) WHERE kind = 'planner' AND status NOT IN ('retired');
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_session_per_role ON agents(role_id) WHERE kind = 'session' AND status NOT IN ('retired');
CREATE INDEX IF NOT EXISTS agents_ws_status ON agents(workspace_id, status);
