-- VS-295: a subscription's own category selection, so delivery can be filtered server-side instead
-- of a device silently discarding what it does not want. Default matches Settings' own toggle
-- defaults (decisions, landed on; everything off).
ALTER TABLE push_subscriptions ADD COLUMN categories_json TEXT NOT NULL DEFAULT '["decisions","landed"]';
