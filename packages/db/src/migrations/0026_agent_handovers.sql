-- A human holding a worker's live CLI session (VS-249): one row per hold. `agent_id` has no
-- UNIQUE constraint of its own — "no second open hold" is enforced by the service layer, which
-- checks for an existing `status = 'active'` row before inserting — because a table CHECK cannot
-- express "unique among rows matching a condition" portably; the partial-unique-index pattern this
-- codebase already uses elsewhere (see `agents_one_worker_per_ticket`) is not needed here since the
-- service already holds the whole write in one place.
--
-- `session_ref_json` and `worktree_head`/`worktree_branch` are snapshots taken when the hold opens,
-- compared against the worker's actual state when the hold is given back or closed automatically.
-- `last_activity_signal`/`last_activity_at` track whether the runtime's own session file has changed
-- since the hold opened or was last checked — the abandonment sweep gates on this, not on elapsed
-- time alone, so a hold still in active use is never closed out from under the human using it.
CREATE TABLE IF NOT EXISTS agent_handovers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  ticket_id TEXT,
  runtime_id TEXT NOT NULL,
  session_ref_json TEXT,
  worktree_head TEXT,
  worktree_branch TEXT,
  started_at TEXT NOT NULL,
  started_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'returned', 'abandoned')) DEFAULT 'active',
  returned_at TEXT,
  note TEXT,
  reconciliation_json TEXT,
  last_activity_signal TEXT,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_handovers_agent_status ON agent_handovers(agent_id, status);
