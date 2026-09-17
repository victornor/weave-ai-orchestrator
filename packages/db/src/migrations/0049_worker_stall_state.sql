-- VS-498. Persists that a worker is in an active stall/recovery cycle: from the moment the
-- supervisor's stall sweep first detects it, through each bounded automatic recovery attempt, until
-- either a run leaves observable evidence of progress (the row is deleted) or the automatic
-- recovery attempts are exhausted and the sweep escalates to the weaver (the row's escalated_at /
-- escalation_decision_id are set, and the row is kept until progress is found). A row's mere
-- existence is the persisted "in an active stall/recovery cycle" fact the workers/tickets reads
-- surface; there is no separate boolean to drift out of sync with it.
CREATE TABLE IF NOT EXISTS worker_stall_state (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_detected_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_attempt_wake_id TEXT,
  escalated_at TEXT,
  escalation_decision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS worker_stall_state_ticket ON worker_stall_state(ticket_id);
CREATE INDEX IF NOT EXISTS worker_stall_state_ws ON worker_stall_state(workspace_id);
