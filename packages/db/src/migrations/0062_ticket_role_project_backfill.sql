-- VS-668: a ticket created with an `assignee_role_id` but no `project_id` stored NULL, even though
-- every role belongs to exactly one project (`roles.project_id` is NOT NULL). A worker was still
-- spawned into the role's project, so the gap only showed in readers of the ticket's *own* project:
-- `weave_ticket_open_pull_request` refused ("has no project to open a pull request against"), roadmap
-- linking rejected the ticket as "not in this project", project-filtered lists omitted it and the
-- merge queue skipped it. Creation and assignment now derive the project from the role; this
-- backfills the tickets already written the old way. Only rows with a null project and a resolvable
-- role are touched, so it is a no-op where there are none.
UPDATE tickets
   SET project_id = (SELECT r.project_id FROM roles r WHERE r.id = tickets.assignee_role_id)
 WHERE project_id IS NULL
   AND assignee_role_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM roles r WHERE r.id = tickets.assignee_role_id);
