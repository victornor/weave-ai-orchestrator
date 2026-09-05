-- A job is one long-running workspace-setup operation, kept so it can be watched while it runs and
-- diagnosed after it ends (VS-37). `steps_json` is the whole ordered sub-step list — seeded
-- complete-and-pending when the job is created, so a surface can draw the sequence before any of it
-- has run — and `log_json` is a bounded tail of the output its commands produced, the same shape the
-- upgrades table uses. The full output is live-only; only the tail is durable, because a clone's
-- stdout is not the product the way a run's events are.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- What the job acts on, so a client that lost its state can find the job still running for a project.
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  -- One of shared's JOB_STATES; forward-only from `running` to a terminal state.
  state TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  log_json TEXT NOT NULL DEFAULT '[]',
  -- The highest line sequence handed out, kept on the row so a resumed stream never repeats one.
  log_seq INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  -- Which sub-step failed; never parse `message` for it.
  failed_step TEXT,
  message TEXT
);
-- The two reads that exist: this project's jobs newest first, and "is one still running".
CREATE INDEX IF NOT EXISTS jobs_entity ON jobs(workspace_id, entity_id, started_at DESC);
