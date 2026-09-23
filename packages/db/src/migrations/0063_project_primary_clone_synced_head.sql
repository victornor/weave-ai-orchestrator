-- VS-673. The clone's HEAD the last time `projects.fetch()` left it matching
-- origin/<landingBranch> — the baseline `fetch()`'s guarded self-heal uses to tell a rewritten
-- remote (safe to reset) apart from a real, unpushed local commit (must not be discarded).
-- Nullable and additive: an existing row starts with no baseline, which is the correct, honest
-- "unknown provenance" state until its next successful fetch records one.
ALTER TABLE projects ADD COLUMN primary_clone_synced_head TEXT;
