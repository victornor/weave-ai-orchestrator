-- ac:foreign_keys_off
-- VS-398. Captain plans large work with a read-only planning agent before any ticket exists, in a
-- modal that shows a live, editable list of draft tickets. A `plan` is that planning session: at most
-- one per project while `drafting` (enforced by `plans_one_drafting_per_project`), scoped to the
-- project with `project_id NOT NULL` and no `workspace_id` — same reasoning as `0040`'s
-- `roadmap_items`: this database is already one per workspace, and the project already carries it.
-- `thread_id` is the chat thread the planning conversation renders through (reusing
-- `channel_threads`/`thread_messages`, not a new chat mechanism); `agent_id` is the live planning
-- agent for this plan, nullable because it is cleared (not the row deleted) once the agent retires on
-- submit or discard, so the plan's history — including who created it and when — survives.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES channel_threads(id),
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('drafting', 'submitted', 'discarded')) DEFAULT 'drafting',
  created_by_kind TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  submitted_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_drafting_per_project ON plans(project_id) WHERE status = 'drafting';
CREATE INDEX IF NOT EXISTS plans_project_status ON plans(project_id, status);

-- A draft ticket in a plan. `position` is a dense manual order, same pattern as `roadmap_items`. `kind`
-- deliberately excludes `question` — the ticket's own field list (VS-398) names exactly
-- change/task/scout/operational. `suggested_tier` is the planner's pick; `tier_override` is captain's,
-- and takes precedence when set (no reason/explanation column for either — captain removed that field
-- during plan review). `status`/`created_ticket_id`/`failure_reason` record what submission did with
-- this draft: still pending, linked to the real ticket the weaver created from it, or failed with a
-- stated reason — never silently dropped.
CREATE TABLE IF NOT EXISTS plan_drafts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('change', 'task', 'scout', 'operational')),
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  target_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  suggested_tier TEXT NOT NULL CHECK (suggested_tier IN ('quick', 'standard', 'deep')),
  tier_override TEXT CHECK (tier_override IN ('quick', 'standard', 'deep')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'created', 'failed')) DEFAULT 'pending',
  created_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_drafts_plan_position ON plan_drafts(plan_id, position);

-- An intra-plan dependency: `plan_draft_id` is blocked by `blocks_on_draft_id`, both drafts of the
-- same plan (real tickets don't exist yet, so this cannot reuse `ticket_relations`). Cycles are
-- rejected in the service layer before insert, the same way `tickets.service.ts` guards
-- `ticket_relations`.
CREATE TABLE IF NOT EXISTS plan_draft_blockers (
  plan_draft_id TEXT NOT NULL REFERENCES plan_drafts(id) ON DELETE CASCADE,
  blocks_on_draft_id TEXT NOT NULL REFERENCES plan_drafts(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_draft_id, blocks_on_draft_id)
);

-- `agents.kind`'s CHECK gains `planner` alongside the existing `weaver`/`worker`, and the table gains
-- `plan_id` — a planning agent's anchor, the way `ticket_id` anchors a worker. Both need the same
-- rebuild-and-copy treatment `0027` used for the `conductor`->`weaver` rename: SQLite cannot ALTER a
-- CHECK constraint, and adding one column alongside is free once the table is already being rebuilt.
-- Column order and content otherwise unchanged since `0027` (verified: no `ALTER TABLE agents` between
-- `0027` and this file).
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL CHECK (kind IN ('weaver','worker','planner')),
  project_id TEXT REFERENCES projects(id), role_id TEXT REFERENCES roles(id), role_revision INTEGER, ticket_id TEXT, plan_id TEXT REFERENCES plans(id), name TEXT NOT NULL,
  runtime_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('provisioning','active','running','paused','error','done','retired')) DEFAULT 'provisioning',
  pause_reason TEXT, error_text TEXT, home_path TEXT NOT NULL, worktree_path TEXT, branch TEXT, turn_epoch INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0, spawned_by TEXT NOT NULL DEFAULT 'system', spawn_reason TEXT, brief_revision INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, retired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pause_detail_json TEXT
);
INSERT INTO agents_new SELECT
  id, workspace_id, kind, project_id, role_id, role_revision, ticket_id, NULL, name,
  runtime_id, status, pause_reason, error_text, home_path, worktree_path, branch, turn_epoch,
  turn_count, spawned_by, spawn_reason, brief_revision, last_run_at, retired_at, created_at, updated_at, pause_detail_json
FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_weaver ON agents(workspace_id) WHERE kind = 'weaver';
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_worker_per_ticket ON agents(ticket_id) WHERE kind = 'worker' AND status NOT IN ('retired');
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_planner_per_plan ON agents(plan_id) WHERE kind = 'planner' AND status NOT IN ('retired');
CREATE INDEX IF NOT EXISTS agents_ws_status ON agents(workspace_id, status);
