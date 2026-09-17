-- VS-526: the worker-options catalog entry a persistent session runs on, mirroring
-- `tickets.worker_model_id` (0021). Nullable with no default: NULL means the session has no option of
-- its own and falls back to the workspace's workers setting, exactly as a ticketless session did
-- before. Set when the session is opened and changeable afterwards.
ALTER TABLE agents ADD COLUMN worker_model_id TEXT;
