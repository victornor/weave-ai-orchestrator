-- VS-358: a project can opt in to also committing its knowledge into `.weave/knowledge/` in its
-- own repo, off by default. Same shape as `openspec_enabled` (0001_init.sql).
ALTER TABLE projects ADD COLUMN knowledge_repo_enabled INTEGER NOT NULL DEFAULT 0;
