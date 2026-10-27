## 1. Service

- [x] 1.1 Add `reclaimFinishedHomes(actor, { dryRun, now? })` to `WorkersService` (and `api.ts`), iterating `paths.workers` and joining each directory to its agent row; eligibility `kind IN ('worker','planner')`, status `retired` or `done`, `COALESCE(retired_at, last_run_at, updated_at)` past `workerArchiveDays`; unknown directories reported and kept.
- [x] 1.2 Add the safety gate: `worktreeChanges` must be clean (tracked and untracked empty), and landed proof must be either a `merged` pull-request work product for the agent's ticket or `landedWorkTest` returning landed; a missing/undeterminable branch, an unreadable worktree and any dirty state are refusals.
- [x] 1.3 Remove through the registered provider with `deleteBranch: false, force: false`, mark the worktrees row `removed`, delete the home only afterwards, and retry a left-behind home (no `work/`) on the next pass.
- [x] 1.4 Record findings: `log.warn` plus a `worker.home_retention_skipped` activity row per refusal and `worker.home_reclaimed` per reclaim, and return `{ dryRun, candidates, reclaimed, skipped, failed }`.
- [x] 1.5 Add a test that a reclaimed home's branch still resolves and `git worktree list` no longer names the worktree.

## 2. Retention pass

- [x] 2.1 Make `retentionPass` async and call `deps().workers.reclaimFinishedHomes(SYSTEM, { dryRun: false })` after the archive pruning, awaiting it from `supervisor.tick` under the existing `supervisor:retention_at` guard.
- [x] 2.2 Keep the run-log and `archive/` pruning unchanged; keep their tests green.

## 3. Operator command

- [x] 3.1 Add `POST /workers/prune-homes` (`{ dryRun }`, default `true`) and its route-table entry, returning the service result.
- [x] 3.2 Add `weave worker prune-homes [--dry-run]` printing candidates, reclaimed and skipped-with-reason.
- [x] 3.3 Test the CLI dry run and real run through the route body: `--dry-run` sends `dryRun: true`, the default sends `false`, and the skip list is printed.
- [x] 3.4 Add the explicit `--ignore-age` opt-in to `reclaimFinishedHomes`, the route and the CLI: it skips only the `workerArchiveDays` cutoff, the retention pass always passes `ignoreAge: false`, and a real run announces the window and how many more homes it widens to before deleting.
- [x] 3.5 Test that `ignoreAge` reclaims an in-window landed home, still refuses a dirty one (it is not force), and that provider removal keeps `deleteBranch: false, force: false`.

## 4. Tests for every refusal and cutoff

- [x] 4.1 Reclaim a `retired` worker past the cutoff and a `done` worker past the cutoff; keep one inside the window.
- [x] 4.2 Refuse: tracked change, untracked-only file, no landed proof, unreadable worktree, undeterminable branch, directory with no agent row; assert each is reported and untouched.
- [x] 4.3 Prove the sweep continues after a refusal (one refused + one reclaimed in the same pass).
- [x] 4.4 Prove the cutoff uses the agent's time, not the directory's: old mtime + recent last turn kept, fresh mtime + old last turn reclaimed, `active`/`running` never touched.
- [x] 4.5 Prove a failed provider removal deletes nothing, and a home left without `work/` is finished by the next pass.

## 5. Verification and measurement

- [x] 5.1 Run the core tests for the touched suites and both full suites per the project conventions; paste both suite blocks in the ticket/PR.
- [ ] 5.2 Record the pre-flight measurement (read-only survey of the live workspace: candidate count, skip list with reasons, bytes) in the ticket report, for both the default and `--ignore-age` sets.
- [ ] 5.3 Write the four-measurement first-run procedure (before `du`; dry run; dry run with `--ignore-age`, where VS-486 and VS-831 must appear as refusals; real run with the flag; after `du` and a sample `git worktree list`) into the ticket report so the acceptance is met by measurement after the upgrade.
