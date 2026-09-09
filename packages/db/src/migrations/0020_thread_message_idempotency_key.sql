-- Client-generated idempotency key on an inbound chat message (VS-148). A retry
-- carrying a key already stored for this thread returns the existing row instead
-- of creating another message and another wake. Null for every message that
-- predates this migration, and for any sender that does not send a key.
ALTER TABLE thread_messages ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS thread_messages_idempotency
  ON thread_messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
