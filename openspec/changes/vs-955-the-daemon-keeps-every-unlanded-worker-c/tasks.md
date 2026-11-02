## 1. Restart wake states the outage honestly

- [x] 1.1 `observeBoot` returns `downAt`/`shutdownReason` only when clean, and adds `lastAliveAt` and `previousInvocationId` (each ignored when older than `previousBootAt`); `markBooted` stores `INVOCATION_ID` and the first `alive_at`. Verify with a `restart-notice.test.ts` case built from the ticket's record (shutdown 02:10:34.237 `SIGTERM`, boot 02:10:34.638, no later shutdown): `clean` false, `downAt` null, `shutdownReason` null, and no reported time predates the previous boot.
- [x] 1.2 Add the 60 s liveness interval in `daemon.ts` (unref'd, try/catch, stopped on shutdown). Verify with a fake-timer test that `alive_at` advances, and that a throwing write neither throws nor stops the interval.
- [x] 1.3 Add `serviceExit.ts`: `readServiceExit(invocationId, run)`, user query then system query, 3 s timeout, output cap, parsing the three MESSAGE_IDs and mapping the signal name. Verify with a fixture holding the captured 2026-11-02 journal lines: `dumped`, `SIGBUS`, `core-dump`, restarts 1, `exitedAt` 20:00:43.527. Also verify that empty output, a non-zero exit, a timeout and garbage lines each return null. Only an injected runner is used; no real `journalctl`.
- [x] 1.4 Extend `RestartNotice` (`downAtSource`, `lastAliveAt`, `exit`) and have `announceRestart` resolve `downAt` as recorded shutdown, then service exit, then null. Rewrite `restartNoticeText`/`restartNoticeReason` for the crash cases. Verify with tests for the three crash lines: with exit ("SIGBUS … down 3 s"), with only `lastAliveAt`, and with nothing ("unknown"). Also verify the clean case is unchanged, and that a hanging runner does not delay `startDaemon` in `restart-notice-boot.test.ts`.
- [x] 1.5 Update the weaver template item 9 and `skills/weave-ai-weaver/SKILL.md`: null `downAt` means unknown; `lastAliveAt` is a bound; never invent an outage length. Verify with the existing template render test, extended to assert the sentence.

## 2. Retained-copy scan and report

- [x] 2.1 Add `RETAINED_COPY_CLASSES`/`RETAINED_COPY_REASONS` to `shared/enums.ts`, the `RetainedCopy`/`RetainedCopiesReport` types, `defaults.retainedCopyOfferDays` (30) in the workspace config, and a migration for the `retained_copies` table. Verify with `pnpm typecheck` and the migration test.
- [x] 2.2 Add typed git helpers in `worktrees/landed.ts`: commits not on the landing branch, commits on no remote, commits only reachable from the checkout's HEAD, branch-exists, head SHA. Verify with unit tests against a temp repo with a bare remote: pushed commit, unpushed commit, detached commit, deleted branch.
- [x] 2.3 Implement `WorkersService.scanRetainedCopies()`. It selects copies (skipping live agents, including orphans), classifies them, computes ages and the offerable flag, measures size with `du -sk` (falling back to the walk, with timeouts), and replaces the table in one transaction. It is serialised by a `scanning` flag. Verify with the acceptance test, a fixture workspace holding:
  - a worker with 2 modified and 3 untracked files;
  - one with 4 commits not on the landing branch, 1 on no remote;
  - one `branch_gone`;
  - an `open` one;
  - a running one;
  - an orphan directory.

  Assert the counts, sizes (> 0), reasons, classes and totals, that the running worker is absent, and that a byte-for-byte listing of every copy is identical before and after the scan.
- [x] 2.4 Make the supervisor trigger the scan daily via `due(...)` without awaiting it in `runStep`. Verify with a supervisor test that a scan that never settles does not keep a step in flight or make the state `stalled`, and that a second trigger while scanning is a no-op.
- [x] 2.5 Add `GET /workers/retained`, `POST /workers/retained/scan` (202), and `retainedCopies` on `GET /api/w/:ws/`, with `routetable.ts` entries. Verify with server route tests over the fixture.
- [x] 2.6 Add `weave worker retained [--json] [--scan]`, a table sorted by size with human-readable sizes and a totals line. Verify with a CLI test against a stubbed client.

## 3. Reclaim, gated on captain's approval

- [x] 3.1 Implement `WorkersService.offerReclaim(actor, directories)`. It drops `open` copies, splits solo from batch, raises human-owned `discard_approval` cards with the `retained_copy_reclaim` target snapshot and a context listing bytes and losses, and skips copies already on an open card. Verify with tests:
  - a set with one unpushed-commit copy and two uncommitted-only copies yields one solo card and one batch card listing both;
  - a `branch_gone` copy whose commits cannot be determined is solo;
  - `open` is refused;
  - after the offer every copy is still on disk, unchanged.
- [x] 3.2 Branch `applyDiscardApproval` on `retained_copy_reclaim` into `reclaimRetained`. It re-reads each copy, refuses on a live worker or a snapshot mismatch, and otherwise removes through the provider with `deleteBranch: false, force: true` and deletes the home. It records activity and posts one chat result line. Verify with tests:
  - approve removes the checkout and home, the branch still resolves with the same commits, and an activity row carries the bytes;
  - reject changes nothing;
  - a head moved after the card refuses that copy while its batch sibling is reclaimed;
  - a relaunched (active) worker is refused.
- [x] 3.3 Pin the no-automatic-removal rule. Verify with tests:
  - `retentionPass`, `scanRetainedCopies` and the disk check over offerable copies with unlanded work and no approved card remove nothing;
  - the auto-approval pass with YOLO on and a weaver `weave_decision_answer` both leave a reclaim card open.
- [x] 3.4 Add `POST /workers/retained/reclaim` and `weave worker reclaim <dir…> | --class <c> [--offerable]`, which print the card ids and never remove anything. Verify with route and CLI tests.
- [x] 3.5 Make the web app's discard card render a reclaim target: a per-copy list of bytes and losses, and the batch total. Verify with a `DecisionCard` test for a solo card and a batch card.

## 4. Storage view

- [x] 4.1 Add a workspace settings section `storage`: last disk check line, totals by class, sortable copy table with checkboxes, "Rescan", and "Offer reclaim" showing the solo/batch split before sending. Verify with a UI test asserting the rendered sizes, reasons and the request body sent. Check the render by eye: screenshot it at phone and desktop width (saved in the agent home) and attach it to the ticket.
- [x] 4.2 Add the `useRetainedCopies` hook and the API client functions. Verify with the UI hook test.

## 5. Low-disk warning

- [x] 5.1 Add `disk.warnFreePercent` (10) and `disk.warnFreeBytes` (50 GiB) to `DaemonConfigSchema`. Verify with the config schema test.
- [x] 5.2 Add `server/src/diskWatch.ts`: an injected `readFs`, de-duplication by device, thresholds with a 5 % recovery margin, episode state in `daemon.sqlite` meta, re-warn at half, the top five copies from each workspace's table, `notifyHuman` per workspace, and one deduped incident. Wire it into `daemon.ts` (10 min, unref'd, not in demo mode). Verify with tests, all with a fake reader:
  - 24 GB of 1.6 TB with copies of 12, 9 and 4 GB gives one warning naming all three and the total, and one incident;
  - a second low check is silent;
  - a halving re-warns;
  - recovery then a drop gives a new episode;
  - above threshold gives nothing;
  - two workspaces on one device give one incident;
  - a throwing reader is logged and the other filesystem is still checked;
  - the episode survives a restart.

## 6. Docs, knowledge and verification

- [ ] 6.1 `docs/OPERATIONS.md`: rewrite "Disk fills up" — what retained copies are, why they are kept, the classes, the Storage view and `weave worker retained`/`reclaim`, the card split and that the branch is kept, the low-disk warning and its thresholds. Correct the stale claim that nothing is pruned. Add the restart-notice crash fields to the service section. Also update `docs/API.md` (new routes, `RestartNotice` fields), `docs/CLI.md` (two commands) and `docs/CONFIGURATION.md` (three keys). Verify by reading the rendered sections against the specs.
- [ ] 6.2 Run `pnpm lint`, `pnpm typecheck` and both test suites (per-directory with `--maxWorkers=1` if the turn's memory limit requires it), and paste both suite blocks verbatim into the PR.
- [ ] 6.3 Update the KB document `worker-home-retention` with the retained-copy section: what they are, why they are kept, how captain reclaims, and the solo/batch rule. Add one hub landmine line pointing at it. Verify by reading the document back with `weave_knowledge_doc_get`.
