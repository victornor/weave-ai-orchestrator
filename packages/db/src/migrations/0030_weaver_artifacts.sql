-- VS-297. A weaver artifact is scoped to the workspace, not a ticket: `ticket_documents`/
-- `ticket_work_products` both carry a NOT NULL ticket_id, so a ticket-less artifact gets its own pair
-- of tables (design.md Decision 2) rather than a nullable-FK rebuild of the existing ones. Shape
-- mirrors `ticket_documents`/`ticket_document_revisions` exactly: a current-revision pointer row, an
-- append-only revisions table. No `url` column — every row is served by exactly one route shape, so
-- the URL is always computed from `workspace_id` + `key`, never stored.
CREATE TABLE weaver_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  kind TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, key)
);

CREATE TABLE weaver_artifact_revisions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES weaver_artifacts(id),
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, revision)
);

CREATE INDEX weaver_artifacts_workspace_updated_idx ON weaver_artifacts (workspace_id, updated_at DESC);
