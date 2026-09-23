## 1. Data model

- [x] 1.1 Add migration `packages/db/src/migrations/00XX_project_primary_clone_synced_head.sql`: nullable `primary_clone_synced_head TEXT` column on `projects`. Verify with a `migrations.test.ts` case asserting the column is absent before and present (nullable, `NULL` on existing rows) after.
- [x] 1.2 Add `primaryCloneSyncedHead: string | null` to the `Project` interface in `packages/shared/src/types.ts`.

## 2. Guarded self-heal in `projects.fetch()`

- [x] 2.1 In `packages/core/src/projects/index.ts`'s `fetch()`, capture the clone's `HEAD` before `checkout`/`merge` (already done as `before`) and compare it against `project.primaryCloneSyncedHead` when `merge --ff-only` fails.
- [x] 2.2 When they match (or, per design.md Decision 1, when there is no recorded watermark — treated as guard-refused, not guard-passed): hard-reset the clone's branch to `origin/<landing>` (`git reset --hard origin/<landing>`), treat the attempt as successful, and log at `info` that the clone was recovered from a rewritten remote.
- [x] 2.3 When they do not match: leave the clone untouched (no reset), keep `syncState: 'diverged'`, and log/report that the clone holds a commit not present on the remote (distinct wording from a plain fast-forward failure).
- [x] 2.4 On every path that leaves the clone `in_sync` (plain fast-forward, no-op already-current, or the guarded reset), write the resulting `HEAD` to `primaryCloneSyncedHead` in the same `ctx.db.update('projects', ...)` call that sets `syncState`/`lastFetchedAt`. Leave it unchanged on the guard-refused path.
- [x] 2.5 Verify with real git repos in `packages/core/src/projects/projects.test.ts` (extending the existing `sourceRepo()` harness — actual force-push/amend simulation, not mocked git calls, per proposal.md - Impact):
  - [x] 2.5.1 Update the existing "marks the clone diverged, not just failed, when it cannot be fast-forwarded (VS-131)" test: after an amend-in-place rewrite with no intervening local write, `fetch()` now resets to the new remote tip, `fastForwarded` is `true`, `syncState` ends `in_sync`, and the working tree reflects the rewritten content.
  - [x] 2.5.2 Add a test: a project whose clone has never reached `in_sync` since a rewrite occurred before any watermark was recorded (simulate by inserting the row with `primaryCloneSyncedHead: null` and a HEAD that predates a rewrite) stays `diverged`, untouched, after `fetch()`.
  - [x] 2.5.3 Add a test for the guard-refused case: after a normal `fetch()` establishes a watermark, commit directly into the clone at `project.clonePath` (simulating `archiveAfterMerge`'s backfill), then diverge `origin` independently (so `merge --ff-only` fails); `fetch()` leaves the clone's `HEAD` and the direct commit untouched, `syncState` stays `diverged`, and no reset occurs.
  - [x] 2.5.4 Add a test: after 2.5.3's guard-refused state, push the clone's local-only commit to `origin` (making it reachable) and call `fetch()` again; it now reaches `in_sync` and records a fresh watermark.

## 3. Curation freshness gate

- [x] 3.1 Confirm (add a regression test if not already covered) that `runs/engine.ts`'s curation-freshness gate needs no code change: after `deps().projects.fetch(project.id)` self-heals, the re-read `project.syncState` is `in_sync` and the turn dispatches normally.
- [x] 3.2 Update the freshness-error message composed in `runs/engine.ts` (used when `syncState !== 'in_sync'`) to say the clone holds a commit not present on the remote, matching design.md Decision 3's distinguishing wording.
- [x] 3.3 In `packages/core/src/runs/engine.test.ts`, add/update cases matching `openspec/specs/knowledge/curation-freshness`'s new scenarios: a rewritten-remote divergence self-heals and the turn runs (no `blocked` transition, no `checkout_stale`); a guard-refused divergence (real local commit) still blocks with `checkout_stale` and the updated message.

## 4. Verify the other callers benefit without code changes

- [x] 4.1 Confirm (with a test if the existing suite doesn't already cover it) that the hourly reconcile sweep (`packages/core/src/supervisor/index.ts`, `reconcilePass`) calling `projects.fetch()` for a rewritten-remote project results in `syncState: 'in_sync'` after the pass, closing the VS-131 silently-logged gap.
- [x] 4.2 Spot-check (read, no code change expected) that `openspec/index.ts`'s pre-archive fetch and `packages/server/src/routes/projects.ts`'s `POST /:id/fetch` route both just call `projects.fetch()` and propagate its result/row, so they inherit the self-heal with no changes needed.

## 5. Validate

- [x] 5.1 `openspec validate vs-673-auto-recover-primary-clone-when-it-can-t --strict` passes.
- [x] 5.2 `pnpm lint && pnpm typecheck` pass.
- [x] 5.3 `pnpm test` — paste both the core/server suite block and the UI suite block verbatim in the delivery report (this change does not touch `packages/ui`, but both suites still run and must both be reported).
