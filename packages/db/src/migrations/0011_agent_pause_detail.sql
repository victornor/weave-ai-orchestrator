-- Why a paused worker stopped, structured (VS-56). `pause_reason` stays the one-line human string;
-- this carries {family, code, message, resetAt, runId} so every surface that already fetches the
-- agent can name the failure family and the runtime's own message without joining runs or the
-- open decision — the decision is withdrawn when the worker recovers, and does not exist at all
-- when raising it failed. Additive, nullable, no backfill: a worker paused before this migration
-- keeps its free-text reason and every reader falls back to it.
ALTER TABLE agents ADD COLUMN pause_detail_json TEXT;
