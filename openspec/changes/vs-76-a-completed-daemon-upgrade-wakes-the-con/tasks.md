## 1. The marker and the facts the announcement reads

- [x] 1.1 Migration `0012_upgrade_announcement.sql`: `announced_at` and `drained_runs` on `upgrades`; the two fields on `Upgrade` in `packages/shared/src/types.ts`.
- [x] 1.2 `Db.appliedMigrations` in `packages/db/src/db.ts` — the migration files this process applied when it opened the database.
- [x] 1.3 `Supervisor.running()` in `packages/core/src/supervisor/index.ts` and its interface in `packages/core/src/api.ts`.
- [x] 1.4 `packages/server/src/upgrade.ts` records `drainedRuns` when it starts holding dispatch.

## 2. The announcement itself

- [x] 2.1 `packages/server/src/upgrade-announce.ts`: `UpgradeAnnouncement`/`UpgradeHealthCheck` in shared, the release-stamp window, the landed-ticket read, `buildAnnouncement()` and `announcementText()` — pure, given the row and the workspace facts.
- [x] 2.2 `UpgradeService.announce()`: claim each unannounced terminal upgrade with a conditional `announced_at` write, then per workspace post the line through `threads.notifyHuman` and enqueue the `system` wake on the conductor. A workspace that throws never blocks another.
- [x] 2.3 `packages/server/src/daemon.ts` calls `announce()` once the listeners are up, and passes the registered runtime ids; `upgrade.ts` calls it after a pre-restart failure so a build or backup failure is announced without waiting for a restart.

## 3. The conductor knows what to do with it

- [x] 3.1 `templates/conductor.AGENTS.md.tmpl`: the line telling the conductor to relay a one-paragraph summary that adds detail rather than repeating the chat line.

## 4. Cover it

- [x] 4.1 `packages/server/test/upgrade-announce.test.ts`: the wake and the chat line after a successful upgrade with the right release pair, landed tickets, migrations and drained/resumed counts; the failure and rollback variants naming the release now running; a failing health check named instead of a claim of success; nothing announced on a plain restart or for a cancelled upgrade; nothing announced twice across a double boot.
- [x] 4.2 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
