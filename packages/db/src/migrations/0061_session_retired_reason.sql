-- VS-656: why a persistent session was retired, so the conversation surface can show a boundary
-- naming the reason the model's memory was reset there. Values are the shared
-- `SESSION_RETIRED_REASONS`: 'tool_contract' (VS-542's fingerprint changed at an upgrade), 'idle'
-- (the session was idle past `sessionMaxIdleDays`), 'runtime' (the worker option moved the session
-- to another runtime) and 'reset' (an operator reset the session). Nullable: NULL means a row
-- written before this migration, which passed no reason and renders the generic restart wording.
ALTER TABLE agent_sessions ADD COLUMN retired_reason TEXT;
