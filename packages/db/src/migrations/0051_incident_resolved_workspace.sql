-- VS-499. Resolution records the workspace it was performed from, so an incident filed in one
-- workspace and resolved from another keeps both sides of the audit trail: `workspace_id` is where it
-- was filed, `resolved_by_workspace_id` is where it was closed. Nullable, no CHECK, so this is a plain
-- column addition (like 0028). Rows resolved before this migration stay null; the workspace cannot be
-- recovered for them from anything stored.
ALTER TABLE incidents ADD COLUMN resolved_by_workspace_id TEXT;
