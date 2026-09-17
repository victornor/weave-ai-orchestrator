-- VS-517: a scout draft dispatched before plan submission is found from its ticket at terminal
-- transition time (to route the report to the plan's planner), so the reverse lookup needs an index.
CREATE INDEX IF NOT EXISTS plan_drafts_created_ticket ON plan_drafts(created_ticket_id) WHERE created_ticket_id IS NOT NULL;
