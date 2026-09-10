-- Catalog option this ticket's worker runs on (VS-162). Nullable with no default: NULL means
-- use the workspace's models.workers setting. Set at create or assign-before-spawn only.
ALTER TABLE tickets ADD COLUMN worker_model_id TEXT;
