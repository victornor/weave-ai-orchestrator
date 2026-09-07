-- The branch a project's tickets' work actually lands on (VS-119), when it differs from the
-- project's default branch (Fernwood lands on `edge`, promoted to `main` separately, by a human).
-- Nullable with no default: NULL means "use the project's default branch", not "land nowhere".
ALTER TABLE projects ADD COLUMN landing_branch TEXT;
