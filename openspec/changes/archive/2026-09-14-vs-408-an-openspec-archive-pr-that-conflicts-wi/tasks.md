## 1. Rebuild a conflicting archive branch in the landing sequence

- [x] 1.1 Add `rebuildArchiveOnConflict?: boolean` (default false) to `ArchiveThenMergeOpts` in `packages/core/src/tickets/archive-before-merge.ts`, and add `{ kind: 'rebuild_failed'; detail: string }` to `ArchiveThenMergeOutcome`.
- [x] 1.2 In `attemptArchiveThenMerge`, when the branch is stale and `rebaseOntoLanding` conflicts: when the opt is set and `changeName` is present, record the pre-archive parent with `git merge-base HEAD origin/<landing>`, `git reset --hard origin/<landing>`, restore `openspec/changes/<changeName>` from that parent when the tip no longer carries it, run `archiveOnBranch`, mark that this attempt already archived, and let the existing `changed` push step force-push `HEAD:refs/heads/<branch>`; when the opt is unset or there is no change, return `conflict` exactly as today.
- [x] 1.3 Catch a rebuild refusal (`archiveOnBranch`'s `OcError`, carrying openspec's message/fix) and return `{ kind: 'rebuild_failed', detail }` without pushing; do not run the later archive-skip block after a successful rebuild (it already archived), leaving that block unchanged for every other path.

## 2. Wire the archive-backfill caller and the new outcome

- [x] 2.1 In `packages/core/src/tickets/service.ts` `landArchiveBackfill`, pass `rebuildArchiveOnConflict: true` to `attemptArchiveThenMerge` and map `outcome.kind === 'rebuild_failed'` to `fail(outcome.detail)`, so openspec's own reason is recorded through `recordArchiveLandingFailure` and the weaver is woken at most once per standing failure.
- [x] 2.2 In `mergeDone`, handle `rebuild_failed` (e.g. `failLanding('rebuilding the archive failed: ' + outcome.detail)`) so the outcome union is exhausted; this arm is unreachable there because the opt is off.

## 3. Tests

- [x] 3.1 In `packages/core/src/tickets/archive-before-merge.test.ts`, add a test: an `ac/archive-<change>` branch cut before main added a spec file the change also touches, with `rebuildArchiveOnConflict: true`, is rebuilt from the landing tip; the pushed branch's tree carries the change under `openspec/changes/archive/`, and the merged spec keeps main's requirements plus the change's own. Use a fake forge and a scratch local origin/clone (no live GitHub).
- [x] 3.2 Add a test that a clean stale archive branch still takes the existing rebase path with the opt set (unchanged behavior), and that a conflicting branch with the opt unset still returns `conflict` without pushing — the normal-ticket regression guard.
- [x] 3.3 In `packages/core/src/tickets/archive-backfill.test.ts`, add a test that a rebuild `openspec` refuses (an archiveable change whose rebuild is blocked) records one `not landed yet` comment carrying openspec's reason, wakes the weaver once across repeated `landArchiveBackfill` calls, and merges nothing; and that a conflicting archive branch with an approved card lands after a successful rebuild.

## 4. Verification

- [x] 4.1 Run `openspec validate vs-408-an-openspec-archive-pr-that-conflicts-wi --json --strict` and fix every reported item.
- [x] 4.2 Run `pnpm lint && pnpm typecheck` and fix every failure.
- [x] 4.3 Run `pnpm test` and paste **both** suite blocks verbatim in the report (core/server, then UI); do not add them together and do not claim both if only one ran.
- [x] 4.4 Confirm no test or command touched the live daemon, systemd, port 7433, captain's clone or GitHub, and state in the report that #313's live landing follows a daemon upgrade and captain's approval of its merge card (the worker does not merge it).
