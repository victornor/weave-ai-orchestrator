-- Unrecognised Telegram senders (VS-135): identity only, never message text, so Settings can list
-- who has tried to talk to the bot and let captain approve one into the allowlist without typing a
-- numeric user id. Capped and expired in application code (ChannelManager.onRejected), not here.
CREATE TABLE IF NOT EXISTS telegram_pending_users (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), external_user_id TEXT NOT NULL,
  username TEXT, display_name TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, external_user_id)
);
