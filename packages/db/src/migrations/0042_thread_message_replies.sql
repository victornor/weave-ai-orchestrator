-- A reply can answer more than one human message when several arrived before the turn that
-- answered them (VS-449). `thread_messages.reply_to_message_id` stays the single *quote* target
-- (the newest message answered, whose body `replyToExcerpt` renders); this table is the complete
-- set of messages a reply answers, one row per pair. The backfill copies every existing
-- single-target reply, so a reader never has to special-case history.
CREATE TABLE thread_message_replies (
  message_id TEXT NOT NULL REFERENCES thread_messages(id),
  replied_to_message_id TEXT NOT NULL REFERENCES thread_messages(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, replied_to_message_id)
);

-- Reverse lookups (which replies answered this message) and the per-run "already linked" check.
CREATE INDEX thread_message_replies_target ON thread_message_replies(replied_to_message_id);

INSERT INTO thread_message_replies (message_id, replied_to_message_id, created_at)
  SELECT id, reply_to_message_id, created_at FROM thread_messages WHERE reply_to_message_id IS NOT NULL;