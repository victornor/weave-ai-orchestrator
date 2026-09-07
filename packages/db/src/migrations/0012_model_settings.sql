-- Model selection becomes two per-workspace settings (VS-77, ADR 0011). A turn's runtime, model and
-- effort are read from `workspace.yaml`'s `models` block and from nowhere else, so every column that
-- existed to override them goes: a project's and a role's runtime and model, a role's effort, and an
-- agent's own model and effort.
--
-- The workspace.yaml migration that derives the two settings runs in the loader and needs to know
-- what the roles were running on — which this file is about to delete. So it stashes that first, in
-- `meta`, and the loader consumes and clears the row after it has written the config. A database
-- created fresh stashes an empty list, which the loader ignores because a new workspace.yaml already
-- carries a `models` block.
INSERT OR REPLACE INTO meta (key, value)
SELECT 'vs77_role_runtimes',
       COALESCE(json_group_array(json_object('runtimeId', runtime_id, 'model', model, 'effort', effort)), '[]')
FROM roles WHERE status <> 'retired';

-- What stays, and why none of it is an override:
--   agents.runtime_id       what the agent is currently on, stamped from the setting; read by the
--                           worker pages, the usage view and the account probe, never to pick a runtime
--   runs.runtime_id, .model what that run actually launched with and what the runtime reported
--   agent_sessions.runtime_id  which CLI issued the session handle, so a runtime change can retire it
--   usage_events.*          the spend record, which must keep describing what was really spent
--
-- One-way: `conductor daemon upgrade` takes a database backup before migrating, and rolling back to a
-- release that predates this restores from it (docs/OPERATIONS.md). DROP COLUMN needs SQLite >= 3.35;
-- node:sqlite on Node 26 is well past it. No index, CHECK or foreign key references these columns, so
-- each drop is a metadata change rather than a table rebuild.
ALTER TABLE projects DROP COLUMN runtime_id;
ALTER TABLE projects DROP COLUMN model;

ALTER TABLE roles DROP COLUMN runtime_id;
ALTER TABLE roles DROP COLUMN model;
ALTER TABLE roles DROP COLUMN effort;

ALTER TABLE agents DROP COLUMN model;
ALTER TABLE agents DROP COLUMN effort;
