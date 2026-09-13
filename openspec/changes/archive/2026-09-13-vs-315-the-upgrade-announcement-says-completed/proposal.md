## Why

On 2026-09-12 four upgrades produced a `daemon.upgraded` announcement that could not be trusted:
three said `completed` while the daemon announcing was still the old release, every one listed
`migrations: []` although two migrations had applied, and every one listed landed tickets that
stopped at VS-302 and named VS-285 twice. Captain waited two hours on a message that read as success
when nothing had restarted. The announcement is the only report the human gets about an upgrade, so
each of its three facts must come from the truth rather than from the announcing process's own
state.

## What Changes

- **The outcome is decided by the release that is running, not by the row's `state`.** A row in
  state `completed` is announced as `completed` only when the announcing daemon is actually on the
  target: a release-path match, or a commit match when the path differs. When the row says
  `completed` but another release is serving, the announcement carries a distinct outcome that says
  so, names the release now running, and never reads as a successful upgrade.
- **Migrations are the release's, not the boot's.** The announcement reports the migration files the
  target release introduces over the source release (present in the target, absent from the source),
  read from the durable `meta` records and the release directories, instead of
  `db.appliedMigrations` — an in-memory array that is empty whenever the process announcing is not
  the one that ran `migrate`.
- **The landed list is one entry per ticket, newest first, and honest about its cap.** Duplicate
  `landed` activity rows for one ticket collapse to their most recent landing; the cap keeps the
  newest; and when it drops anything, both the chat line and the wake payload state how many landed
  tickets were not listed. No silent cap.
- The one-line chat text (`announcementText`) and the wake reason (`announcementReason`) gain a
  branch for the new outcome; every outcome's text stays truthful.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `daemon-upgrade/upgrade-announcement`: the outcome must reflect the running release; the named
  migrations must be the release window's, not the announcing boot's; the landed list must be one
  entry per ticket, newest first, with its cap stated.

## Impact

- `packages/server/src/upgrade-announce.ts` — `upgradeOutcome` (running-target match + new outcome),
  `buildAnnouncement` (dedupe/order/omitted count, migration window), `announcementText` and
  `announcementReason` (the new outcome).
- `packages/shared/src/types.ts` — `UpgradeAnnouncement.outcome` gains the new value; the payload
  gains `ticketsOmitted`.
- `packages/server/src/upgrade.ts` — `facts()` stops reading `db.appliedMigrations` and supplies the
  release's migration files plus the durable applied set; `landedTickets` orders newest-first.
- `packages/release/src/index.ts` — a `migrationsIn(release)` helper that lists a release's
  `packages/db/dist/migrations/*.sql`.
- Tests: `packages/server/test/upgrade-announce.test.ts` (real-shape outcome, earlier-process
  migration, over-cap dedupe), `packages/release/src/index.test.ts` for the new helper.
- No route, schema, migration or web-UI change. Out of scope: the restart runner, `planRestart`,
  `SERVICE_NAME`, the systemd unit and the release sha (the companion ticket), and the changelog's
  own storage or the web upgrade screens.
