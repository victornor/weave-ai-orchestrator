-- VS-874. The identity this project's agents commit as, when it differs from the workspace default.
-- NULL means "inherit defaults.workerGitIdentity" — never the clone's user.email.
ALTER TABLE projects ADD COLUMN worker_identity_json TEXT;
