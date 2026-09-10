-- System incidents agents file through ac_incident (VS-174). Daemon-level: this table is used in
-- daemon.sqlite, so there is no foreign key to a workspace. The same migration runs on workspace
-- databases (openDaemonDb shares the schema file); those copies stay empty.
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  reporter_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  what_failed TEXT NOT NULL,
  trying_to_do TEXT NOT NULL,
  evidence TEXT,
  workspace_id TEXT,
  project_id TEXT,
  ticket_id TEXT,
  agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  role_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_reporter_kind ON incidents(reporter_kind, created_at DESC);
