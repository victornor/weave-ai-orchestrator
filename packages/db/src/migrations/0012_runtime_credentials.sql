-- The credential state per runtime (VS-75): whether the one credential this host shares for a
-- runtime is present, when it expires, when it was last seen working and when a refresh last
-- failed. Separate from runtime_accounts, which is a usage snapshot deleted and re-inserted on
-- every probe — a gate must not be destroyed by a probe.
--
-- `needs_login = 1` is the gate: the dispatcher starts no turn for any agent on that runtime until
-- a probe clears it. An empty table means no failure has been recorded, which is the correct
-- initial state, so there is nothing to backfill.
--
-- No column here holds a token or any part of one, and none ever may.
CREATE TABLE IF NOT EXISTS runtime_credentials (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  runtime_id TEXT NOT NULL,
  -- is there a credential file at all
  present INTEGER NOT NULL DEFAULT 0,
  -- what the credential asserts about itself; NULL when it is present but says nothing, never guessed
  expires_at TEXT,
  -- the last time a turn or a probe on this runtime succeeded
  last_verified_at TEXT,
  -- the last time a turn failed to authenticate; NULL once the gate clears
  refresh_failed_at TEXT,
  -- the gate: 1 stops every turn on this runtime in this workspace
  needs_login INTEGER NOT NULL DEFAULT 0,
  -- the runtime's own words about the last failure, for the surfaces. Redacted of any token.
  detail TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, runtime_id)
);
