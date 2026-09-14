-- VS-397. A project's roadmap: remembered ideas that are not yet tickets. One row per idea, scoped to
-- one project, in a manual dense order (`position`, zero-based per project). `project_id` carries
-- ON DELETE CASCADE so a hard delete of a project can never strand an item; project removal in Weave
-- AI is a soft archive that keeps the project row, so items normally survive attached to the archived
-- project. `ticket_id` is the ticket an idea became, set when work starts — nullable, and
-- ON DELETE SET NULL so no link can outlive a deleted ticket. No `workspace_id`: this database is
-- already one per workspace, and the project already carries it.
CREATE TABLE IF NOT EXISTS roadmap_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idea','planned','dropped')) DEFAULT 'idea',
  ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  created_by_kind TEXT NOT NULL,
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS roadmap_items_project_position ON roadmap_items (project_id, position);
