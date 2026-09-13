## 1. The outcome reflects the release that is running

- [x] 1.1 In `packages/server/src/upgrade-announce.ts`, change `upgradeOutcome(row, running)` so a `completed` row returns `completed` only when `row.toRelease === running.path`, or when those paths differ but `row.toSha === running.sha`; when the row is `completed` and neither matches, return the new outcome `recorded_completed`. Keep the existing rule for non-completed rows (`rolled_back` when the target differs, else `failed`). Extract the running-target test into a small helper so it reads once.
- [x] 1.2 In `packages/shared/src/types.ts`, add `'recorded_completed'` to `UpgradeAnnouncement['outcome']` and document it: a record that says completed while the announcing daemon runs another release.
- [x] 1.3 In `packages/server/src/upgrade-announce.ts`, add a branch to `announcementText` for `recorded_completed` that names the target and the release now running and says the upgrade is recorded completed while another release is serving; it must not claim the system is back up when a health check failed. Add the matching branch to `announcementReason`. Leave `completed`/`failed`/`rolled_back` text unchanged.
- [x] 1.4 Confirm `to.version` stays `null` for `recorded_completed` (only a running target carries its version) and `failure` still carries the row's `reason`/`message`.

## 2. Migrations are the release's, not the boot's

- [x] 2.1 In `packages/release/src/index.ts`, add `migrationsIn(release: string | null): string[]` listing the `.sql` files under `<release>/packages/db/dist/migrations`, sorted; return `[]` when the release is null or unreadable. Export it.
- [x] 2.2 In `packages/server/src/upgrade-announce.ts`, replace `AnnouncementFacts.migrations: string[]` with a `migrationsIn(release)` seam and a `migrationsApplied: string[]` (the durable record); add an exported pure `upgradeMigrations(row, migrationsIn, applied)` that returns `applied ∩ (migrationsIn(to) − migrationsIn(from))`, falling back to `applied ∩ migrationsIn(to)` when the source release is unreadable and `[]` when the target is unreadable. `buildAnnouncement` uses it for `migrations`.
- [x] 2.3 In `packages/server/src/upgrade.ts`, change `facts()` to (a) supply `migrationsIn: migrationsIn` from `@weave-ai/release`, and (b) read `migrationsApplied` from the durable `meta` table (`value FROM meta WHERE key LIKE 'migration:%'`) on the daemon db and the workspace db instead of `db.appliedMigrations` / `w.ctx.db.appliedMigrations`.
- [x] 2.4 In `packages/release/src/index.test.ts`, cover `migrationsIn`: a directory with migration files lists them sorted; a missing directory and a null release return `[]`.

## 3. The landed list is one entry per ticket, newest first, with its cap stated

- [x] 3.1 In `packages/server/src/upgrade.ts`, change `landedTickets` to `ORDER BY a.created_at DESC`. In `packages/server/src/upgrade-announce.ts`, add an exported helper that dedupes a `LandedTicket[]` by identifier keeping the most recent landing, sorted newest-first; `buildAnnouncement` uses it for both the `undelivered` identifier set and the capped `tickets` list.
- [x] 3.2 In `packages/shared/src/types.ts`, add `ticketsOmitted: number` to `UpgradeAnnouncement`: how many landed tickets the cap left out of `tickets`.
- [x] 3.3 In `packages/server/src/upgrade-announce.ts`, compute `ticketsOmitted = max(0, landed.length - ANNOUNCED_TICKETS)` and append a pluralised `N more landed tickets not listed.` clause to the completed `announcementText` only when it is greater than zero; leave the line unchanged when the cap hides nothing.

## 4. Tests built from the real shape

- [x] 4.1 In `packages/server/test/upgrade-announce.test.ts`, add a case seeding a `completed` row whose `toRelease`/`toSha` differ from `releaseRoot`: the announced `outcome` is not `completed` (it is `recorded_completed`), the payload names the running release, and both `announcementText` and `announcementReason` say the upgrade is recorded completed while another release is serving. Add the path-differs/sha-matches case asserting `completed`.
- [x] 4.2 In the same file, add a migration case built from real temporary release directories: the source release carries migration set A, the target carries A ∪ B, the two databases' `meta` tables record A ∪ B as applied, and the announcing process's `appliedMigrations` arrays are empty (migrations ran earlier). Assert `migrations` equals B. Add the "migration present in the source" and "applied but not carried by the target" exclusions, and update the existing "Every migration, because these databases were opened empty" assertion to the new window semantics.
- [x] 4.3 In the same file, add a >20 landed case including one ticket landed twice, asserting each ticket appears once at its newest landing, the newest are kept, the oldest are dropped, and both `ticketsOmitted` and the `announcementText` clause report the omitted count. Add an under-cap case asserting `ticketsOmitted === 0` and no clause.
- [x] 4.4 Update the existing "the announcement line, on its own" fixtures for the new required `ticketsOmitted` field and add text cases for the `recorded_completed` outcome (healthy and unhealthy).

## 5. Verification

- [x] 5.1 Confirm the change is confined to `packages/server/src/upgrade.ts`, `packages/server/src/upgrade-announce.ts`, `packages/shared/src/types.ts`, `packages/release/src/index.ts` and their tests; `grep` shows no `packages/ui`, `packages/render`, `packages/cli` consumer of `upgradeOutcome`, `announcementText`, `announcementReason` or the announcement payload.
- [x] 5.2 Run `pnpm lint`, `pnpm typecheck`, and both suites (`pnpm test`), and paste both suite blocks verbatim in the delivery report — never summed, never retyped.
