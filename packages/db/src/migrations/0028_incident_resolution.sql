-- VS-271. An incident gains a resolution lifecycle: resolved_at set marks it dealt with, recording
-- who (resolved_by_agent_id) and why (resolution), plus an optional, unvalidated reference to the
-- ticket that fixed the cause (resolution_ticket_id). All four are nullable with no CHECK, so this is
-- a plain column addition — no foreign-keys-off rebuild needed (unlike 0027's CHECK-narrowing ones).
ALTER TABLE incidents ADD COLUMN resolved_at TEXT;
ALTER TABLE incidents ADD COLUMN resolved_by_agent_id TEXT;
ALTER TABLE incidents ADD COLUMN resolution TEXT;
ALTER TABLE incidents ADD COLUMN resolution_ticket_id TEXT;
