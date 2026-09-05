-- The per-project merge queue (PLAN §11.4): a ticket that enters `merging` joins its project's queue
-- instead of merging immediately. `merge_queued_at` is when it joined, `merge_started_at` when the
-- queue admitted it to the active merge step. Waiting = merging with no start; active = merging with
-- one. Position is derived from `merge_queued_at`, never stored, so a departure cannot renumber wrongly.
-- Both are null for every ticket that predates this migration and for every ticket outside `merging`.
ALTER TABLE tickets ADD COLUMN merge_queued_at TEXT;
ALTER TABLE tickets ADD COLUMN merge_started_at TEXT;
CREATE INDEX IF NOT EXISTS tickets_merge_queue ON tickets(project_id, merge_queued_at);
