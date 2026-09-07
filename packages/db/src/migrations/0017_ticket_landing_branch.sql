-- A ticket may declare its own landing branch, overriding its project's (VS-119) — e.g. a hotfix
-- captain asks to land directly on `main` in a project whose tickets otherwise land on `edge`. Set
-- only at creation, nullable with no default: NULL means "use the project's landing branch".
ALTER TABLE tickets ADD COLUMN landing_branch TEXT;
