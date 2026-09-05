-- `activity` is the append-only record of everything that happened in a workspace, and it is what the
-- changelog (PLAN §13.6) projects over. It carried a `ticket_id` but no project, so answering "what
-- happened in this project" meant a different join per row kind: through `tickets` for a ticket row,
-- through `roles` for a hire, and through `entity_id` itself for a project row. This adds the column so
-- a project's changelog is one indexed scan, and backfills it for the history already recorded (VS-55).
--
-- Additive on purpose: a nullable column plus two indexes. SQLite adds the column with a NULL default
-- and no table rebuild, and a release that predates this ignores both, so rolling back needs no
-- down-migration. Nothing here rewrites a recorded row's meaning — only its project is filled in.
ALTER TABLE activity ADD COLUMN project_id TEXT;

-- Anything about a ticket belongs to that ticket's project. A ticket with no project (a workspace-level
-- ticket) correctly leaves this NULL, which is what puts it in the workspace changelog only.
UPDATE activity SET project_id = (SELECT t.project_id FROM tickets t WHERE t.id = activity.ticket_id)
  WHERE ticket_id IS NOT NULL AND project_id IS NULL;

-- `role.hire` and the other role actions name the role in `entity_id`; a role always has a project.
UPDATE activity SET project_id = (SELECT r.project_id FROM roles r WHERE r.id = activity.entity_id)
  WHERE project_id IS NULL AND entity_type = 'role';

-- `project.add` and friends name the project itself. The EXISTS guard keeps a row whose project has
-- since been removed from claiming an id that no longer resolves.
UPDATE activity SET project_id = entity_id
  WHERE project_id IS NULL AND entity_type = 'project' AND EXISTS (SELECT 1 FROM projects p WHERE p.id = activity.entity_id);

-- The changelog pages newest-first and the heatmap scans a date range; ids are ULIDs, so (created_at, id)
-- is a total order and these cover both the workspace scope and a single project's.
CREATE INDEX IF NOT EXISTS activity_changelog ON activity(workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activity_changelog_project ON activity(workspace_id, project_id, created_at DESC, id DESC);
