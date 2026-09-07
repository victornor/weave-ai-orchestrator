-- The status a ticket held immediately before it transitioned to `blocked` (VS-118), so resuming a
-- parked worker or resolving a dependency can put the ticket back where it actually was instead of
-- guessing from a signal that is already gone by the time either reads it. Set and cleared by
-- `tickets.transition()` alone. Plain column add, no CHECK, no FK: safe on a live database with real
-- ticket rows, and NULL for every ticket already blocked when this migration runs.
ALTER TABLE tickets ADD COLUMN blocked_from_status TEXT;
