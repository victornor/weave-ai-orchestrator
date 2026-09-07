-- VS-92. Three columns on `decisions`:
--
-- `project_id` — which project a decision belongs to, so a card can say so. Resolved once when the
-- decision is raised rather than derived on every read: a decision raised about a ticket that is
-- later moved keeps naming what it was raised about, and `decisions.list` stays one indexed read.
-- Backfilled below from the ticket, which is where every existing decision's project comes from.
--
-- `inputs_json` / `answer_inputs_json` — what the card asks for beyond an option, and what it
-- collected. They pair up the way `options_json` and `answer_key` already do.
--
-- ALTER TABLE, not a rebuild: 0010 already replaced this table for its `kind` CHECK, and its
-- `INSERT … SELECT *` matched by position, so appending columns after it is safe. Nothing here
-- touches a CHECK, so the rebuild recipe and its foreign-key caveat do not apply.
ALTER TABLE decisions ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE decisions ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE decisions ADD COLUMN answer_inputs_json TEXT;

UPDATE decisions
   SET project_id = (SELECT t.project_id FROM tickets t WHERE t.id = decisions.ticket_id)
 WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS decisions_ws_project ON decisions(workspace_id, project_id);
