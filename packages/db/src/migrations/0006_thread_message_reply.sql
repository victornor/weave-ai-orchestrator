-- The message a human message replies to (PLAN §14.2): the conductor chat lets the human answer one
-- specific conductor message, and that reference travels with the message into the human_message wake
-- payload so the conductor knows what is being answered. Null when the message replies to nothing, and
-- for every message that predates this migration. No ON DELETE: thread messages are never deleted.
ALTER TABLE thread_messages ADD COLUMN reply_to_message_id TEXT REFERENCES thread_messages(id);
