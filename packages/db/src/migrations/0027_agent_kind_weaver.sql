-- ac:foreign_keys_off
-- VS-259. The `conductor` agent kind becomes `weaver`. Three independent constraints spell the
-- value and all three are referenced tables (agent_sessions.agent_id, role_revisions.role_id,
-- tickets.assignee_role_id, agent_handovers.agent_id, jobs.agent_id, incidents-adjacent reads, …),
-- so this file opts into `Db.migrate()`'s `-- ac:foreign_keys_off` (FK off before BEGIN, restored
-- after COMMIT and on rollback), same as 0023.
--
-- `agents.kind`'s CHECK becomes ('weaver','worker'); `agents_one_conductor`'s predicate and name
-- both move to `agents_one_weaver` — an index still named `_one_conductor` after this ships would
-- be exactly the half-renamed, no-error failure this migration exists to prevent. Column order is
-- today's: 0001 then 0011's appended `pause_detail_json` (0012 dropped `model`/`effort`, which is
-- why they are absent below). `spawned_by` (no CHECK — found by the column-value scan, not by any
-- constraint, same as `role_revisions.author`) carries `'conductor'` whenever an agent actor spawned
-- a worker (`packages/core/src/workers/index.ts`'s `spawnedBy` ternary), so it is transformed here
-- alongside `kind` rather than left for a separate pass.
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK (kind IN ('weaver','worker')),
  project_id TEXT REFERENCES projects(id), role_id TEXT REFERENCES roles(id), role_revision INTEGER, ticket_id TEXT, name TEXT NOT NULL,
  runtime_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('provisioning','active','running','paused','error','done','retired')) DEFAULT 'provisioning',
  pause_reason TEXT, error_text TEXT, home_path TEXT NOT NULL, worktree_path TEXT, branch TEXT, turn_epoch INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0, spawned_by TEXT NOT NULL DEFAULT 'system', spawn_reason TEXT, brief_revision INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, retired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pause_detail_json TEXT
);
INSERT INTO agents_new SELECT
  id, workspace_id, CASE WHEN kind = 'conductor' THEN 'weaver' ELSE kind END, project_id, role_id, role_revision, ticket_id, name,
  runtime_id, status, pause_reason, error_text, home_path, worktree_path, branch, turn_epoch,
  turn_count, CASE WHEN spawned_by = 'conductor' THEN 'weaver' ELSE spawned_by END, spawn_reason, brief_revision, last_run_at, retired_at, created_at, updated_at, pause_detail_json
FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_weaver ON agents(workspace_id) WHERE kind = 'weaver';
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_worker_per_ticket ON agents(ticket_id) WHERE kind = 'worker' AND status NOT IN ('retired');
CREATE INDEX IF NOT EXISTS agents_ws_status ON agents(workspace_id, status);

-- `decisions.owner`'s CHECK becomes ('human','weaver'). `kind`'s CHECK (already carrying
-- `action_approval` per 0023) is copied forward unchanged. The four `conductor_review_*` columns
-- (added by 0025 as plain ALTER TABLE ADD COLUMN, appended after `answer_inputs_json`) are renamed
-- to `weaver_review_*` in this same rebuild rather than a second pass — `decisions` is already being
-- torn down for the `owner` CHECK. Column order is today's: 0001, then 0010/0018/0023's `kind`
-- rebuilds (no column changes, only the CHECK), then 0025's four appended columns.
CREATE TABLE decisions_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), ticket_id TEXT REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('approval','question','concern','gate_finding','plan_approval','hire_approval','merge_approval','discard_approval','retry_approval','action_approval')),
  owner TEXT NOT NULL CHECK (owner IN ('human','weaver')), asked_by_agent_id TEXT, asked_in_run_id TEXT, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', allow_free_text INTEGER NOT NULL DEFAULT 1, recommendation TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','answered','expired','withdrawn','superseded')) DEFAULT 'open', answer_key TEXT, answer_text TEXT,
  answered_by_kind TEXT, answered_by_id TEXT, answered_at TEXT, expires_at TEXT, target_json TEXT, correlation_key TEXT, created_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), inputs_json TEXT NOT NULL DEFAULT '[]', answer_inputs_json TEXT,
  weaver_review_status TEXT NOT NULL DEFAULT 'unseen', weaver_reviewed_at TEXT, weaver_review_note TEXT, weaver_reviewed_by_agent_id TEXT
);
INSERT INTO decisions_new SELECT
  id, workspace_id, ticket_id, kind, CASE WHEN owner = 'conductor' THEN 'weaver' ELSE owner END, asked_by_agent_id, asked_in_run_id, title, context,
  options_json, allow_free_text, recommendation, status, answer_key, answer_text,
  answered_by_kind, answered_by_id, answered_at, expires_at, target_json, correlation_key, created_at,
  project_id, inputs_json, answer_inputs_json,
  conductor_review_status, conductor_reviewed_at, conductor_review_note, conductor_reviewed_by_agent_id
FROM decisions;
DROP TABLE decisions;
ALTER TABLE decisions_new RENAME TO decisions;
CREATE UNIQUE INDEX IF NOT EXISTS decisions_open_corr ON decisions(ticket_id, correlation_key) WHERE status = 'open' AND correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS decisions_ws_status ON decisions(workspace_id, status);
CREATE INDEX IF NOT EXISTS decisions_ws_project ON decisions(workspace_id, project_id);

-- `roles.created_by`'s default becomes 'weaver'. SQLite has no `ALTER TABLE ... ALTER COLUMN SET
-- DEFAULT`, so this needs the same rebuild-and-copy treatment even though no CHECK is involved.
-- `role_revisions`'s FK targets `roles(id)`, unaffected by a column default change.
CREATE TABLE roles_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT NOT NULL REFERENCES projects(id), slug TEXT NOT NULL,
  name TEXT NOT NULL, title TEXT, icon TEXT, charter_summary TEXT NOT NULL, scope_text TEXT NOT NULL, responsibilities_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '[]', rules_json TEXT NOT NULL DEFAULT '[]', permission_json TEXT NOT NULL DEFAULT '{}', session_policy TEXT NOT NULL CHECK (session_policy IN ('per_ticket','fresh','persistent')) DEFAULT 'per_ticket',
  max_workers INTEGER NOT NULL DEFAULT 2, secrets_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending_activation','active','paused','retired')) DEFAULT 'pending_activation', pause_reason TEXT,
  spec_revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL DEFAULT 'weaver', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);
INSERT INTO roles_new SELECT
  id, workspace_id, project_id, slug, name, title, icon, charter_summary, scope_text, responsibilities_json,
  capabilities_json, rules_json, permission_json, session_policy,
  max_workers, secrets_json,
  status, pause_reason,
  spec_revision, CASE WHEN created_by = 'conductor' THEN 'weaver' ELSE created_by END, created_at, updated_at
FROM roles;
DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;

-- Two more columns carry the literal with no CHECK or default naming it, so no rebuild is needed —
-- a plain row-data UPDATE suffices. `role_revisions.author` is every existing revision's actor
-- string; `incidents.reporter_kind` is empty in every workspace database (incidents are filed at
-- the daemon level) but non-empty in `daemon.sqlite`, which runs this same migration file.
UPDATE role_revisions SET author = 'weaver' WHERE author = 'conductor';
UPDATE incidents SET reporter_kind = 'weaver' WHERE reporter_kind = 'conductor';
