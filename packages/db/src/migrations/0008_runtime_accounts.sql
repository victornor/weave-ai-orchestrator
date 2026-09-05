-- The current account snapshot per runtime (PLAN §16.2): how the credentials in this workspace's
-- runtime home are billed, and the plan limit windows the CLI reports. Refreshed by the supervisor
-- poll; a new snapshot replaces the previous one, so there is exactly one row per runtime and no
-- history. An empty table is the pre-change behaviour: every reader falls back to 'unknown'.
CREATE TABLE IF NOT EXISTS runtime_accounts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  runtime_id TEXT NOT NULL,
  -- one of shared's BILLING_TYPES
  billing_type TEXT NOT NULL DEFAULT 'unknown',
  plan_label TEXT,
  limits_available INTEGER NOT NULL DEFAULT 0,
  -- AccountLimitWindow[]; a display payload with a per-runtime shape, never a query predicate.
  limits_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, runtime_id)
);
