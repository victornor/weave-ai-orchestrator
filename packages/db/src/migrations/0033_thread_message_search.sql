-- VS-320. Full-text search over a thread's stored messages. A dedicated table, not
-- `knowledge_search`: that table has no `thread_id`/`workspace_id` columns, only `project_id`,
-- which means nothing for a chat message, and conflating an append-only message log with curated
-- knowledge/spec content would be its own mess. `workspace_id` is denormalized onto each row (read
-- once via the same `channel_threads -> channels.workspace_id` join `ThreadsService.get()` already
-- does) so a search query filters `thread_id`/`workspace_id` directly rather than joining three
-- tables on every read.
CREATE VIRTUAL TABLE IF NOT EXISTS thread_message_search USING fts5(message_id UNINDEXED, thread_id UNINDEXED, workspace_id UNINDEXED, body);

INSERT INTO thread_message_search (message_id, thread_id, workspace_id, body)
SELECT m.id, m.thread_id, c.workspace_id, m.body
FROM thread_messages m
JOIN channel_threads t ON t.id = m.thread_id
JOIN channels c ON c.id = t.channel_id;
