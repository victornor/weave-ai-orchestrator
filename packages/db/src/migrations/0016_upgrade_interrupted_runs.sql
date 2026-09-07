-- A deferred upgrade's wait for idle is bounded (VS-115, daemon-upgrade/deferred-upgrade): once the
-- bound expires it proceeds to build anyway, instead of failing. `interrupted_runs` is how many runs
-- were still executing at that moment, recorded the same way `drained_runs` is, because nothing can
-- count it afterwards.
ALTER TABLE upgrades ADD COLUMN interrupted_runs INTEGER;
