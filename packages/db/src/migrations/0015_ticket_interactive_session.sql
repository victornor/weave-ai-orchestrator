-- An interactive session (VS-101) always has a ticket: the human starts one from an existing ticket
-- or by creating one in the same action, and the session's agent is that ticket's worker throughout.
-- This flag is the session's whole persistent record — there is no separate table. Plain column add,
-- no CHECK, no FK: safe on a live database with real ticket rows.
ALTER TABLE tickets ADD COLUMN interactive_session INTEGER NOT NULL DEFAULT 0;
