-- A finished upgrade is announced once (VS-76, daemon-upgrade/upgrade-announcement): the daemon that
-- comes back tells the human on the chat thread and wakes each workspace's conductor with what changed.
-- `announced_at` is the marker that makes it once-only — the announcer claims a row by setting it
-- conditionally on it being NULL, so a plain restart finds nothing to announce and a crash mid-boot
-- cannot announce the same upgrade twice. `drained_runs` is what the upgrade waited out before it
-- built anything, recorded when dispatch was held because nothing can count it afterwards.
ALTER TABLE upgrades ADD COLUMN announced_at TEXT;
ALTER TABLE upgrades ADD COLUMN drained_runs INTEGER;
-- Upgrades that were already over when this shipped are marked announced, so the first daemon to run
-- this code reports the upgrade that installed it and stays quiet about every one before it.
UPDATE upgrades SET announced_at = COALESCE(finished_at, requested_at)
 WHERE announced_at IS NULL AND state IN ('completed', 'failed', 'cancelled');
