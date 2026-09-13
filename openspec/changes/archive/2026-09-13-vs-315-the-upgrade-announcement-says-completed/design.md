## Context

The upgrade announcement is built by `packages/server/src/upgrade-announce.ts` from an `Upgrade`
row plus `AnnouncementFacts` read in `packages/server/src/upgrade.ts` (`facts()`). `announce()`
claims the row once by `announced_at` and posts `announcementText` on each workspace's chat plus one
`system` wake carrying the whole `UpgradeAnnouncement` payload. The module is deliberately pure so
it can be tested with no daemon, no release directory and no channel.

The incident (2026-09-12, upgrades to `98672d89b6`) proved three of those facts are not what the
announcement reads them to be:

1. `upgradeOutcome` returns `completed` the moment `row.state === 'completed'`, before it ever looks
   at the running release. The restart runner can mark a row `completed` while the old daemon is
   still the one serving, so the announcement claimed success on a daemon that had not moved.
2. `facts()` takes `migrations` from `db.appliedMigrations` / `w.ctx.db.appliedMigrations`. Per
   `packages/db/src/db.ts:17,44` those are instance arrays filled only by the current process's own
   `migrate()` run. When migrations ran in an earlier boot — exactly what happens when the announcing
   process is not the migrating one — the array is empty and the announcement reports none.
3. `landedTickets` orders `a.created_at ASC` and `buildAnnouncement` slices `landed.slice(0, 20)`.
   A busy release keeps its oldest twenty and drops the newest, and duplicate `landed` rows for one
   ticket (VS-285's 14:10 merge and its 14:41 retried completion) are not collapsed.

## Goals / Non-Goals

**Goals**

- An announcement can never call an upgrade `completed` unless the announcing daemon is running the
  target release.
- The migrations named are the ones the release introduced, independent of which process ran
  `migrate`.
- The landed list is one entry per ticket, newest first, and its cap is stated rather than silent.
- `announcementText` and `announcementReason` stay truthful for every outcome, including the new one.

**Non-Goals**

- The restart runner, `planRestart`, `SERVICE_NAME`, the systemd unit and the release sha; why the
  restart never happened is the companion ticket.
- The upgrade changelog's storage and the web upgrade screens.
- Changing the release-window definition for landed work (`releaseBuiltAt` of the two directories).

## Decisions

### D1: A new outcome value, `recorded_completed`, and `completed` requires a running-target match

`upgradeOutcome` becomes: a `completed` row is `completed` only when

```
(row.toRelease && running.path && row.toRelease === running.path)
|| (row.toSha && running.sha && row.toSha === running.sha)
```

When the row is `completed` but not on target it returns a new outcome, `recorded_completed`. A
non-completed row keeps today's rule (`rolled_back` when its target is not what is running, else
`failed`). `UpgradeAnnouncement.outcome` gains the value, and `announcementText` /
`announcementReason` get a branch that names the release now running and states that the record says
completed while another release is serving.

Alternatives considered:

- **`rolled_back`.** Rejected: it reports a deliberate restoration to the previous release, which is
  not what happened. A human who reads "was rolled back" would conclude the rollback machinery ran;
  the failure was that the record and reality disagreed.
- **`failed`.** Rejected: closer, but it discards the one fact that made the incident confusing —
  that the record says `completed`. A reader would not learn the record is stale, which is precisely
  what they need to distrust the changelog row too.
- **A new `UpgradeFailureReason` on a `failed` outcome.** Rejected: the failure-reason enum is about
  *why an execution failed*; this is a discrepancy between two records, not an execution failure, and
  the text would still have to special-case the message to say "recorded completed". A distinct
  outcome is the smaller, more truthful change.

The new value is deliberately not named `completed` in any prefix a reader could mistake for
success; the text states the mismatch in full. `to.version` stays `null` for it (only a running
target has a version to report), and `failure` keeps carrying the row's `reason`/`message` (null for
a completed row).

### D2: Migrations come from the release pair's migration directories, filtered by the durable applied record

Two independent sources are combined:

1. **The release delta.** A new leaf helper `migrationsIn(release)` in `packages/release` lists
   `<release>/packages/db/dist/migrations/*.sql` (the build copies them there). The window is
   `migrationsIn(toRelease)` minus `migrationsIn(fromRelease)` — the same previous-to-next window
   used for landed work.
2. **The durable applied record.** `facts()` reads `value FROM meta WHERE key LIKE 'migration:%'`
   from the daemon db and the workspace db, instead of the in-memory `appliedMigrations` arrays.
   This survives the process boundary: it is written to the database by whichever process ran the
   migration.

The reported set is `applied ∩ (migrationsIn(to) − migrationsIn(from))`. This is correct across
processes for two reasons: the database record does not depend on which process booted, and the file
delta does not depend on the database at all. A migration applied by an earlier process is named
because it is in `applied`; a migration that existed already in the source release is excluded
because it is in `from`; a migration the target does not carry is excluded by the `to` filter.

When the target's migration directory cannot be read, the announcement falls back to
`applied ∩ migrationsIn(to)` (empty if even that cannot be read), never inventing a file the target
does not carry. This is the one case where an older migration can be over-listed, and it is rare:
`pruneReleases` keeps `keep` (default 3) releases and never prunes `previous`, so `fromRelease`
survives an announcement.

Alternatives considered:

- **Directory delta only.** Simpler, but claims a migration ran just because the release carries it,
  even if the DB never applied it. The `applied` filter keeps the claim honest.
- **Durable `applied` only (no release window).** This is the direct fix for "empty because another
  process migrated", but on its own it lists every migration the database ever applied, not the
  upgrade's. The window is what makes it a report about *this* upgrade.
- **A per-migration timestamp.** None is recorded — `meta` stores only `migration:<file>` — so
  "recorded as applied since `fromRelease` was built" cannot be read literally. The file delta is
  the usable equivalent of "since the source release".

`packages/release` is a leaf and already imports `readdirSync`; the helper belongs there beside
`releaseSha` and `commitSubjectsInRange`.

### D3: One entry per ticket, newest first, and the cap is stated

`landedTickets` orders `a.created_at DESC`. A small exported helper dedupes by `identifier`,
keeping the first (newest) sighting and preserving that order, sorted by `at` descending so the
pure function does not depend on the SQL order. `buildAnnouncement` then takes
`landed.slice(0, ANNOUNCED_TICKETS)` and computes
`ticketsOmitted = max(0, landed.length - ANNOUNCED_TICKETS)`.

`UpgradeAnnouncement` gains `ticketsOmitted: number`. `announcementText`'s completed branch appends
` N more landed tickets not listed.` (pluralised, and only when `ticketsOmitted > 0`), mirroring the
briefing's `N more waiting` fix from VS-308's shape and the existing `undelivered` clause. The
`undelivered` detection keeps using the full deduped set, so this remains true.

Alternatives considered:

- **Oldest-first, take the newest twenty.** Rejected as needless arithmetic and an order the reader
  has to invert; newest-first is what "what landed" wants to see first, so select it directly.
- **Dedupe in SQL (`GROUP BY`).** Keeping the newest row per ticket needs the landed timestamp and
  the ticket identity; the helper is clearer and unit-testable, and the query stays a plain read.

## Risks / Trade-offs

- **A new `outcome` value reaches an unaware consumer.** The only consumers are this server module
  and its tests (`grep` shows no UI/render/CLI use of `upgradeOutcome` or the payload's `outcome`),
  and the wake payload is free-form JSON, so the blast radius is contained to the files listed.
- **`ticketsOmitted` required on the payload could break fixtures.** Only the announcement builder
  produces it and the tests construct it; the field is added to the single shared interface and
  every construction site is updated in the same change.
- **The migration fallback can over-list older migrations if the source release is pruned.** Kept
  rare by `pruneReleases` (keeps the previous release) and documented in the requirement; the
  primary path never over-lists.
- **The `applied` read is per database and the daemon db is shared.** Migrations can differ between
  workspaces, which matches today's per-workspace union; the workspace db is included as before.

## Migration Plan

No schema, route or UI change; the release helper only reads the filesystem. Deployment is the normal
merge plus `weave daemon upgrade`. Rollback is a revert of the commit: the added payload field is
absent from an old producer, and no reader requires it, so a new-code announcement still parses in
older code and vice versa.

## Open Questions

None.
