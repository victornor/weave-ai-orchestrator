-- VS-579: a role's worker memory limit in MB, overriding the workspace default. Nullable with no
-- default: NULL means the role inherits the workspace default (which in turn may be derived).
ALTER TABLE roles ADD COLUMN memory_limit_mb INTEGER;
