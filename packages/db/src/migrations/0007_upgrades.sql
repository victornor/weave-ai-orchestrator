-- A deferred daemon upgrade (PLAN §20): `conductor daemon update apply` and the web app's Upgrade
-- action record their intent here instead of performing it, so the daemon can hold dispatch, wait for
-- every running turn to finish, and still report the outcome after the restart that ended the session
-- which asked for it. Daemon-level: this table is used in `daemon.sqlite`, so there is no workspace_id
-- and no foreign key to anything. `state` is one of shared's UPGRADE_STATES, forward-only.
CREATE TABLE IF NOT EXISTS upgrades (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  -- `--test`: run the new release's test suite before switching to it.
  run_test INTEGER NOT NULL DEFAULT 0,
  target_sha TEXT,
  from_release TEXT,
  to_release TEXT,
  to_sha TEXT,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  reason TEXT,
  message TEXT,
  log_json TEXT NOT NULL DEFAULT '[]',
  backups_json TEXT NOT NULL DEFAULT '[]',
  came_back_version TEXT
);
-- The only read that matters is "the latest one", and "is one still in flight".
CREATE INDEX IF NOT EXISTS upgrades_requested_at ON upgrades(requested_at DESC);
