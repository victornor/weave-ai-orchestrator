-- VS-110. Knowledge context (hub bootstrap tokens plus distinct document reads) is a different
-- question from usage_events' billed model tokens, so it gets its own event table rather than a
-- column bolt-on: one row per (run, hub-chunk-or-document), grouped and windowed the same way
-- usage_events already is. The unique index is what makes "counted once per distinct document per
-- run" a guarantee rather than application logic that could drift — a second read of the same
-- (run, kind, scope, doc_project, slug) is inserted with INSERT OR IGNORE and silently drops.
CREATE TABLE IF NOT EXISTS knowledge_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  -- No FK to runs(id): usage_events sets the same precedent, since a run row and its usage/knowledge
  -- events are written independently within a turn and neither table's tests seed a real runs row.
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  ticket_id TEXT,
  -- The run's own project (the agent's project; null for a conductor run), same convention as
  -- usage_events.project_id — this is what a "per project" rollup filters on, never doc_project_id.
  project_id TEXT,
  -- 'hub': rendered into the agent's bootstrap digest. 'document': returned by an explicit
  -- ac_knowledge_get or ac_knowledge_doc_get call. The same scope can appear as both in one run.
  kind TEXT NOT NULL CHECK (kind IN ('hub','document')),
  scope TEXT NOT NULL CHECK (scope IN ('workspace','shared','decisions','project')),
  -- Which project this specific hub chunk or document belongs to, only set when scope = 'project'.
  -- Distinct from project_id: a conductor run's project_id is null but it renders one 'project'
  -- chunk per project, each needing its own doc_project_id to stay distinguishable.
  doc_project_id TEXT,
  slug TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_usage_dedupe
  ON knowledge_usage_events(run_id, kind, scope, IFNULL(doc_project_id, ''), IFNULL(slug, ''));
CREATE INDEX IF NOT EXISTS knowledge_usage_ws_time ON knowledge_usage_events(workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS knowledge_usage_project_time ON knowledge_usage_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS knowledge_usage_ticket ON knowledge_usage_events(ticket_id);
