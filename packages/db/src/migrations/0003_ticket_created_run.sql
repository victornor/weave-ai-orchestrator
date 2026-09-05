-- Provenance for a ticket's creation (PLAN §11): which agent run filed it. The conductor chat reads
-- this to anchor a dispatch label to the message its turn produced. Null for tickets a human or the
-- system created outside any run, and for every ticket that predates this migration.
ALTER TABLE tickets ADD COLUMN created_run_id TEXT;
