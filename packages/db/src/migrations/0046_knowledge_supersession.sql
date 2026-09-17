-- VS-492: what a curated replacement supersedes. The entries a replacement corrected, recorded on
-- the revision that replaced them, alongside the archive copy every replaced entry already keeps.
-- Additive provenance only: no knowledge content is changed by it.
ALTER TABLE knowledge_revisions ADD COLUMN superseded_entries_json TEXT NOT NULL DEFAULT '[]';
