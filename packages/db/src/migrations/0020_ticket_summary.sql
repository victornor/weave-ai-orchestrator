-- One-line why for a ticket (VS-146), shown on plan-approval cards in weave chat.
-- Nullable with no default: existing tickets simply have no summary until one is set.
ALTER TABLE tickets ADD COLUMN summary TEXT;
