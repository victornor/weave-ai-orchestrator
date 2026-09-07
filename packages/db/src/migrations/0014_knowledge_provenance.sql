-- VS-102. A knowledge write already records who wrote it (author_kind, author_id, run_id); it does
-- not record which ticket the run belonged to, which is the thing a future reader actually wants to
-- open. Nullable, no backfill: a write made with no run behind it (a human edit, the daemon seeding
-- or correcting a file) has no ticket, and an existing revision is left exactly as it was.
ALTER TABLE knowledge_revisions ADD COLUMN ticket_id TEXT REFERENCES tickets(id);
