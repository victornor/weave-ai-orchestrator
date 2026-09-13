-- VS-316: whether an upgrade migrated the host's systemd unit (or launchd agent) from the pre-rename
-- name to the current one, fell back to the pre-rename one after a cutover failure, or never got past
-- preparing the new one. NULL means migration was not applicable — the host was already on the current
-- name, or has neither systemd nor launchd. Independent of the upgrade's own `state`/`reason`/`message`:
-- a migration-cutover failure that successfully falls back does not by itself fail the upgrade, so this
-- is the only place that distinction is recorded.
ALTER TABLE upgrades ADD COLUMN migration_outcome TEXT;
