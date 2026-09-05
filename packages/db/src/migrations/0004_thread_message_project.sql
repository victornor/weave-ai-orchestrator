-- The project a human message was sent with (PLAN §14.2): the conductor chat lets the human pick a
-- project beside the input, and that choice travels with the message into the human_message wake
-- payload. Null when no project was chosen, and for every message that predates this migration.
ALTER TABLE thread_messages ADD COLUMN project_id TEXT REFERENCES projects(id);
