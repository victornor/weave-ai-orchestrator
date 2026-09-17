-- VS-493: a derived, content-hash keyed index of knowledge chunks for opt-in semantic search.
-- Purely additive: it is built by reading the existing markdown knowledge tree and is read only by
-- `weave_knowledge_semantic_search`. Dropping this table and unregistering that tool is the whole
-- rollback; no knowledge file, revision, link or FTS row depends on it.
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  chunk_hash TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  section TEXT,
  kind TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT NOT NULL,
  vec BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_embeddings_ref_hash ON knowledge_embeddings(workspace_id, ref, chunk_hash);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_scope ON knowledge_embeddings(workspace_id, project_id);
