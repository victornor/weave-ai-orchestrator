-- VS-622. A draft ticket's optional short summary (a sentence or two), shown on the collapsed draft
-- card in the Plan tab beside the title; the full `description` stays untouched and is what becomes
-- the created ticket. Nullable with no default: a draft without a summary falls back to the first
-- sentence of its description at render time, so existing rows need no backfill.
ALTER TABLE plan_drafts ADD COLUMN summary TEXT;
