-- Linked knowledge documents (PLAN §13, "documents"): every knowledge file can link to a document
-- with [[slug]]; links are indexed so agents can list, traverse and see backlinks, and the web app
-- can draw the graph.
CREATE TABLE IF NOT EXISTS knowledge_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  from_path TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  to_path TEXT,
  PRIMARY KEY (workspace_id, from_path, to_slug)
);
CREATE INDEX IF NOT EXISTS knowledge_links_to ON knowledge_links (workspace_id, to_path);
