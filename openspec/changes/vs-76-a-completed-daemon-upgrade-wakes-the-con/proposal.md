## Why

VS-28 made the daemon upgrade itself: hold dispatch, wait for every running turn, build, back up, swing `current`, hand off to a detached runner that restarts the service and verifies the release that comes back. All of that is recorded on the `upgrades` row, and the row outlives the restart — which is the only reason the outcome is reportable at all.

Nothing reports it. The daemon that comes back reconciles the record, writes one `daemon.upgraded` activity row per workspace, and says nothing to anyone. The workspace owner, right after an upgrade: *"We should make the upgrades ping the conductor, letting it know the system was upgraded and fully back up."* Today the conductor learns it happened by noticing its tool list changed, and the human by noticing the update indicator went away. Neither is told what landed in the release, whether the databases migrated, or whether the daemon actually came back healthy rather than half-up.

Everything the announcement needs is already recorded: the release pair and the timestamps on the `upgrades` row, the landed work in `activity` (`ticket.delivery_landed`, what the changelog already projects as `landed`), the migrations the databases applied on open, the conductor agent in each workspace, and `threads.notifyHuman` as the channel path to the primary thread. What is missing is a step that reads them once, on the boot that follows the upgrade, and tells both audiences.

## What Changes

- **A terminal upgrade is announced exactly once.** The `upgrades` row gains `announced_at`: the marker the booting daemon reads and stamps under a conditional write, so a plain restart announces nothing (there is no unannounced terminal upgrade), a double boot announces nothing twice, and a crash between the two writes cannot duplicate the announcement.
- **The human is told first, over the channel path.** The moment the daemon is listening again it posts one short line on the primary chat thread — `upgraded to <version> (<sha>), back up at HH:MM` — through `threads.notifyHuman`, not through a conductor turn, so it arrives even if the conductor is paused, gated or busy.
- **The conductor is woken with the detail.** A `system` wake per workspace carrying the previous and new release (path, commit, version), when the upgrade started and finished, how many runs were drained and how many wakes resume now, the tickets whose landed work is included in the new release, the migrations that ran, and the health checks.
- **"Fully back up" is a claim the daemon checks.** Three checks — the workspace database answers, the supervisor is ticking, runtime adapters are registered — decide whether the message says it is back up or names the check that failed. `Supervisor` gains `running()` so "ticking" is read rather than assumed.
- **A failure or a rollback is announced the same way**, with the reason, the message, and the release that is running now. The outcome is derived from the facts: a failed upgrade whose target is not the release now executing is reported as rolled back.
- **The conductor's job description says what to do with the wake**: relay a one-paragraph "upgraded and back up" summary, adding the detail the chat line does not carry, then carry on.

## Capabilities

### New Capabilities

- `daemon-upgrade/upgrade-announcement`: what a finished upgrade tells the workspace — the once-only marker, the chat line, the conductor wake and its payload, the health checks behind "back up", and the failure and rollback variants.

## Impact

- `packages/db/src/migrations/0012_upgrade_announcement.sql` — `announced_at` and `drained_runs` on `upgrades`.
- `packages/db/src/db.ts` — `Db.appliedMigrations`, the migrations this process applied on open.
- `packages/shared/src/types.ts` — the two new `Upgrade` fields; `UpgradeAnnouncement` and `UpgradeHealthCheck`.
- `packages/core/src/api.ts`, `packages/core/src/supervisor/index.ts` — `Supervisor.running()`.
- `packages/server/src/upgrade-announce.ts` — the pure part: the release pair, the window of landed work, the payload and the one-line text.
- `packages/server/src/upgrade.ts` — record `drainedRuns`, `announce()`, and the call after a pre-restart failure.
- `packages/server/src/daemon.ts` — announce once the listeners are up.
- `templates/conductor.AGENTS.md.tmpl` — the line about the wake.
- Tests: `packages/server/test/upgrade-announce.test.ts`.

## Out of scope

- How the upgrade itself runs (VS-28's pipeline and ADR 0008): nothing about the build, the switch, the runner or the rollback changes.
- A route or a screen for the announcement; the chat thread and the changelog already carry it.
- Announcing anything about an upgrade that was cancelled before it built.
