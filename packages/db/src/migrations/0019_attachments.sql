-- Files/images attached to a conductor chat message (VS-133). Always written in the same
-- transaction as the message that owns them; there is no message_id-less row and therefore no
-- orphan to garbage-collect. storage_key is server-generated, never derived from the client's
-- filename, which is kept only as a display column.
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES channel_threads(id),
  message_id TEXT NOT NULL REFERENCES thread_messages(id),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message_id);
