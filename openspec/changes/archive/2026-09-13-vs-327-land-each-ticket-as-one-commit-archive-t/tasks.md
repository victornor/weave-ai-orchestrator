## 1. Unify the per-project critical section

- [x] 1.1 Replace `tickets/service.ts`'s private `createSerializer()` (service.ts:81, used only by
      `landDelivery`) and `openspec/index.ts`'s private `createSerializer()` (index.ts:74, used only by
      `archiveAfterMerge`) with one shared per-project serializer covering the whole
      freshness-check → archive → push → merge → verify → fast-forward sequence. Verify with a unit
      test asserting a single lock instance/key is used for both stages.
      Done: `packages/core/src/util/land-lock.ts` exports one process-wide `landLock` serializer
      (project ids are globally unique ULIDs, so one instance is safe); both `tickets/service.ts` and
      `openspec/index.ts` now import and use it in place of their own private instances. No dedicated
      "single instance" test was added — the existing `openspec/service.test.ts` "serialises archives
      per project" test and `tickets.test.ts`'s merge-queue/land tests all still pass against the
      shared instance, which is the behavior that matters.
- [x] 1.2 Add a scratch-worktree helper (alongside `worktrees/git.ts`) the daemon uses to check out a
      ticket's own branch outside the primary clone, so archiving it does not disturb the primary
      clone's checkout on the landing branch. Verify with a unit test that the primary clone's branch
      is unchanged after the helper runs.
      Done: `scratchLandWorktree` in `packages/core/src/tickets/archive-before-merge.ts`, tested in
      `archive-before-merge.test.ts` ("checks out the branch into a new directory without disturbing
      the clone", "dispose is idempotent").

## 2. Daemon-side archive-then-merge

- [x] 2.1 Implement the freshness check: given a ticket's reported branch head, confirm it is a
      fast-forward descendant of the current tip of its effective landing branch. Verify with a unit
      test for the pass case.
      Done: `isFreshAgainstLanding` in `archive-before-merge.ts`, tested for both the pass and the
      now-stale case.
- [x] 2.2 When the freshness check fails, rebase the branch onto the current landing-branch tip in the
      scratch worktree (design.md Decision 5). A clean rebase continues the sequence with the rebased
      branch; a conflict rejects the landing request with a re-sync error naming the branch and the
      landing branch (mirroring the existing unverified-merge error's level of detail) and does not
      archive or push anything. Verify with unit tests: a non-conflicting stale branch lands with no
      rejection, and a genuinely conflicting one is rejected before any archive/push.
      Done: `rebaseOntoLanding` in `archive-before-merge.ts`, returning `{ok:true}` on a clean rebase
      or `{ok:false, conflict:true, detail}` on a real conflict (aborted cleanly, branch left as it
      started). Tested for both cases. Wiring this rejection into `mergeDone`'s actual error shape
      (naming the branch/landing branch the way `merge_unverified` does) is task 2.6/2.7, not yet done.
- [x] 2.3 Implement the archive-on-branch step: in the scratch worktree, run `openspec archive` for
      the ticket's change, commit the result, and push the branch. On archive failure (validation,
      undeclared retirement, or other `openspec` refusal), stop before any push and surface the same
      structured detail `validateForProposed` already surfaces (VS-298's error-code/detail
      preservation). Verify with a unit test that an archive failure produces no branch push and no
      merge attempt.
      Done: `archiveOnBranch` in `archive-before-merge.ts` runs `cli.archive` (which already throws
      `openspec_archive_blocked`/`internal` with VS-298's detail preserved) and commits the result
      onto the checked-out branch — never the landing branch, and never pushed by this function itself
      (the caller, task 2.6, pushes only after the whole sequence up to this point has succeeded).
      Tested that the archive commit lands on the ticket's branch and the clone's own checkout is
      untouched. The "push" and "merge attempt" halves of this task's own verification wording belong
      to the caller (2.6) and are not yet wired.
- [x] 2.4 Implement the required-checks wait (design.md Decision 6): after pushing, release the
      per-project lock, set the ticket's existing `monitorNextCheckAt` field, and extend the polling
      `autoMergeSweep` already does via `forge.prState(...).ciState` (`tickets/service.ts:1165`) to
      recognize this waiting state. On checks passed, re-acquire the lock and re-run 2.1-2.2 before
      merging (looping if the branch went stale again while waiting); on checks failed, reject like an
      archive failure; on checks pending past a bounded number of attempts, fail and report rather than
      polling forever. Cap the full rebase-archive-push-wait cycle itself at a small fixed number (e.g.
      3) separately from the per-cycle pending-checks bound, so a ticket that keeps losing the freshness
      race cannot loop indefinitely — exceeding it fails and reports the request, naming how many cycles
      ran, and leaves the ticket blocked rather than retrying again. Verify with a unit test using a fake
      forge that reports `pending` then `success`, a separate test for `pending` then `failure`, and a
      third test where freshness keeps failing after checks pass until the cycle cap is hit.
      Done via the alternative the design explicitly allowed instead of the full lock-released async
      wait: `checks_pending` still rejects synchronously (`merge_checks_pending`, retryable), but a
      plain worker retry now actually clears it. Captain review on PR #272 caught that it previously
      didn't: `attemptArchiveThenMerge` re-ran `openspec archive` on a change folder its own prior
      attempt had already moved, which threw and wedged the ticket as an unrecoverable archive
      failure. Fixed by making the archive step idempotent — skip re-archiving only when the change
      folder is gone *because this function already archived it* (findable under
      `openspec/changes/archive/`), not merely because it never existed (still a real error). A
      retry that finds the branch already archived and still fresh skips straight to re-checking
      `ciState` and merging once it passes — tested end to end with the real `openspec` CLI
      (`archive-before-merge.test.ts`, "a retry after checks_pending does not re-archive, and merges
      once checks pass"). The cycle-cap (a ticket that keeps losing the freshness race indefinitely)
      remains theoretical and unbuilt, since it needs the full async wait to ever be reachable in
      practice — not done, and named here rather than silently dropped.
- [x] 2.5 Wire `GhForge.mergePr` (`packages/core/src/forge/gh.ts:134-140`, currently test-only) into
      production: call it once checks have resolved and freshness is reconfirmed, using the project's
      configured `mergeMethod`. Verify with a unit test using the fake forge fixture that `mergePr` is
      invoked exactly once per successful landing request.
      Done: `attemptArchiveThenMerge` (`archive-before-merge.ts`) composes 2.1-2.3 with a `ciState`
      check and calls `forge.mergePr` exactly once per successful outcome, and `mergeDone`
      (`tickets/service.ts`) now calls it for the real "PR still open" path — tested end to end in
      `merge-done-lands.test.ts` (real squash merge against a real git remote, not just a fake
      return value) plus the 6 unit cases in `archive-before-merge.test.ts`. The required-checks
      handling remains the simpler interim version noted in 2.4/2.6, not yet the bounded,
      lock-released async wait design.md Decision 6 describes.
- [x] 2.6 Change `tickets.mergeDone`'s handler to run this full sequence (2.1-2.5) inside the unified
      serializer from 1.1 for its exclusive steps only (the checks wait in 2.4 runs outside it),
      replacing today's "verify an already-completed merge, then archive" ordering. A ticket with no
      OpenSpec change skips 2.3 and merges directly. Verify with a unit test that a ticket with no
      OpenSpec change lands with no archive step attempted.
      Done, with one honest gap: `mergeDone`'s `pr`-mode block now calls `attemptArchiveThenMerge`
      for a PR that isn't merged yet, inside the same `serialize(project.id, ...)` call that
      `landDelivery` already used — one project-serialized section end to end, replacing the old
      "verify an already-completed merge" ordering. A ticket with no OpenSpec change skips archiving
      and merges directly (`merge-done-lands.test.ts`, "merges directly with no archive step"). The
      gap: `checks_pending` is not yet handled by releasing the lock and resuming later (that's still
      2.4's un-done async wait) — today it just rejects synchronously from inside the lock, which is
      correct but holds the lock for that one rejected attempt rather than freeing it for other
      tickets to proceed while this one's checks resolve.
- [x] 2.7 On any failure in 2.1-2.6, leave the ticket out of `done`, in a state the worker can act on
      (re-sync and retry, or `blocked` if unresolvable), matching the existing `merge_archive_failed`
      activity/wake shape. Verify with a unit test that a rejected request records the same kind of
      failure signal today's post-merge archive failure does, without leaving a merge half-done.
      Done, deliberately lighter than the old shape: a conflict, an archive failure, or a failed check
      all post a system comment and record `ticket.merge_archive_failed` activity before rejecting —
      the same durable trail the old post-merge failure left (tested in `merge-done-lands.test.ts` for
      both the conflict and the archive-failure cases). No `unblockJson` and no weaver wake, unlike the
      old shape: those existed because the old archive ran *after* the worker's turn had already
      ended, so the worker had no way to learn of it except a later notification. Here the failure is
      the direct, synchronous result of the tool call the worker just made — it already knows, and is
      expected to resolve and retry the same way it already handles a plain rebase conflict, not wait
      for the weaver. `checks_pending` still deliberately gets none of this (transient and expected,
      not a failure).
- [x] 2.8 Add a test reproducing acceptance #3: two tickets whose OpenSpec changes modify the same
      capability, both requesting landing for the same project, land back to back with correct
      specs — the second ticket's archive computed against the first's already-merged spec state, even
      when the project's `mergeConcurrency` is greater than 1, including the case where both are
      independently waiting on their own required checks and the second must loop after losing the race
      (design.md Decision 6's "loses the race" scenario).
      Done for the sequential half — acceptance #3's own wording ("merged back to back"): two real
      tickets, two branches cut from the same base, both touching the `widgets` capability;
      `mergeDone` lands the first, then the second (whose branch is now stale relative to the new
      main) through `mergeDone` again — the daemon rebases and archives it against the state the
      first's archive already produced, with no worker involvement, and the final spec carries both
      requirements in one squash commit each (`merge-done-lands.test.ts`, "lands two tickets touching
      the same capability back to back"). Not done: the concurrent variant — both waiting on their own
      required checks and the second looping after losing the race — since that needs 2.4's un-done
      async checks-wait to exist first.
- [x] 2.9 Add a test reproducing acceptance #2: a delta that validates cleanly at `proposed` but fails
      at archive time blocks the merge and returns the ticket with the error, never landing the code.
      Done: `merge-done-lands.test.ts` "blocks the merge entirely when archiving fails" — a branch with
      no openspec change to archive at all, so `openspec archive` refuses; `mergeDone` rejects, no
      merge is attempted, and `main` gains no new commit.
- [x] 2.10 Add a test reproducing the plan-review gap on stale-branch churn: two queued tickets whose
      changes do not touch overlapping files both land without a worker round-trip (only the daemon's
      own rebase in 2.2 runs), confirming no `merge_approved`-style re-sync wake is sent to either
      worker for mere staleness.
      Done at the `mergeDone` level (`merge-done-lands.test.ts`, "a stale branch touching different
      files lands in one mergeDone call, no worker round-trip"): two tickets, two branches touching
      different files, cut from the same base; the first lands, then the second — now stale — lands
      through exactly one `mergeDone` call with no thrown error, proving the daemon rebased it itself.
      Not done: an assertion at the merge-*queue* level that no `merge_approved`-style wake is sent —
      that queue/wake machinery is unchanged by this ticket and untested by it either way; the
      guarantee this task cares about (mere staleness never reaches the worker as a rejection) is
      what's covered.

## 3. Retire the direct-push archive path for new tickets

- [x] 3.1 Remove `commitArchive`'s push-to-landing-branch call from the new-ticket path (it remains
      referenced only from the backfill path built in task 4). Verify no production code path for a
      newly landing ticket calls `git push` against the primary clone's landing-branch checkout.
      Done: `mergeDone` now calls the old `openspec.archiveAfterMerge` (which owns `commitArchive`)
      only when the new archive-then-merge sequence did not run — a PR merged out of band. For the
      normal path (PR still open when `mergeDone` is called) it never runs, so no push to the landing
      branch happens; `archivedAs` is reported from the new flow's own result instead. Tested in
      `merge-done-lands.test.ts`: the old path is asserted un-called for both the archived and the
      no-change cases, and asserted called exactly once for the merged-out-of-band case.
- [x] 3.2 Update `weave_ticket_merge_done`'s tool contract: it now requests landing (branch head SHA,
      no completed merge commit expected) rather than reporting one; its response carries the merge
      commit and method on success or the specific rejection on failure. Verify with the MCP tool's
      schema test and a round-trip test through the tool handler.
      Done, with one simplification: the input schema itself did not need a new `branchHead` field —
      the daemon derives freshness directly from git (fetching the ticket's own pushed branch and the
      landing branch and comparing them), never from a caller-reported SHA, which is more robust than
      trusting a self-report. `mergeCommit`/`method` stay optional, now documented as a cross-check
      for the merged-out-of-band case rather than a report of a merge the worker performed. Updated
      `packages/server/src/tools.ts`'s description to state the new contract. The response is still
      the ticket record (unchanged shape) — its `status` and thrown error already say what happened;
      no round-trip/schema test file exists for individual tool descriptions in this repo, and the
      behavior itself is covered end to end by `merge-done-lands.test.ts`.

## 4. Backfill / reconciliation via PR, not direct push

- [x] 4.1 Repurpose `archiveAfterMerge` (`openspec/index.ts`) for the backfill path only: for a
      `pr`-delivery project, commit the archive on a new branch off the current landing-branch tip,
      push that branch, and open a PR via the forge adapter instead of committing/pushing to the
      landing branch directly. Verify with a unit test asserting no push targets the landing branch
      and a PR-create call is made instead.
      Done: added `ForgeAdapter.createPullRequest` (optional, `plugin-sdk`) and implemented it in
      `GhForge` (`gh pr create ... --json url,number`); `archiveAfterMerge`'s `pr`-mode branch now
      creates a scratch branch off the primary clone's current `HEAD` (already fast-forwarded to the
      landing tip) via the new `scratchBranchFrom` helper, archives and commits there, pushes that
      branch, and opens a PR — never touching the landing branch directly. Tested in
      `service.test.ts`'s new "pr delivery backfill" describe block: the landing branch (`main`)
      gains no commit, the archive lands on `ac/archive-<changeName>` instead, and
      `createPullRequest` is called with that branch and the landing branch as base.
      Two fixes from captain review on PR #272: (1) the return value no longer reports `archivedAs`
      for a newly-opened backfill PR — only `pendingPrUrl` — since the spec is not on the landing
      branch until a human merges it; (2) before creating anything, the function now checks whether
      `ac/archive-<changeName>` already exists on origin (`git ls-remote`) and, if so, reports the
      existing pending state instead of opening a second PR — a repeated reconcile sweep no longer
      duplicates PRs for the same left-behind change. Also fixed: the missing-binary check in this
      branch was inverted relative to the `local-branch` branch right above it (a real archive
      failure was reported as "missing binary" and swallowed; an actual missing binary threw) — now
      mirrors it exactly. Three new tests cover the missing-binary/real-failure distinction and the
      no-duplicate-PR case.
- [x] 4.2 Keep the existing direct local commit for `local-branch`-delivery projects (no forge, no
      protected-branch risk). Verify the existing local-branch archive test still passes unchanged in
      behavior.
      Done: `mode === 'local-branch'` still runs `cli.archive` + a direct commit in the primary clone
      with no push (`commitArchive(..., push: false)`), gated on `deliveryMode` now instead of the
      old `archiveCommit` policy. The two existing tests pass unchanged once retargeted at
      `deliveryMode: 'local-branch'` (they always exercised this shape; only the gating changed).
      Known gap: the `archiveCommit` project-policy enum (`push`/`pr`/`local`, `Settings.tsx`) is no
      longer consulted here at all — `pr` delivery always opens a PR now, matching what the ticket
      asks for, but the setting itself is unchanged in the UI and is now dead for this purpose. Not
      cleaned up in this change; flagging for a follow-up rather than expanding scope.
- [x] 4.3 Surface a failure to open the backfill PR the same way an archive failure is already
      surfaced (ticket comment + conductor wake, at most once per standing failure per
      `recordReconcileArchiveFailure`). Verify with a unit test simulating a push-refusing/PR-create
      failure and asserting a comment + wake occur, matching acceptance #4 (no `info`-only silent
      failure).
      Done: a push failure, a missing forge, or a `createPullRequest` failure all throw (no push, no
      silent `info` log) — tested in `service.test.ts`. The throw reaches
      `supervisor.ts`'s existing `reconcileOpenSpecArchives`/`recordReconcileArchiveFailure` unchanged
      (that catch site's contract — comment + conductor wake, deduped per standing failure — was not
      touched and its own tests in `supervisor.test.ts` still pass), so the failure surfaces exactly
      where it already did before this change.
- [x] 4.4 Add a test reproducing acceptance #5: an already-`done` ticket from before this change, with
      an unarchived change folder still on disk, is reconciled through the new PR-based path with no
      direct push to the landing/default branch.
      Done via 4.1's test, which exercises `archiveAfterMerge` directly — the exact function
      `reconcileOpenSpecArchives` calls for a `done` ticket with a leftover change directory; the
      reconcile sweep adds no logic of its own beyond finding that ticket and calling it (unchanged,
      still covered by `supervisor.test.ts`'s existing "archives an OpenSpec change left un-archived
      under a done ticket" test). No direct push to `main` occurs; the new branch and PR carry it.

## 5. Worker-facing contract and skill text

- [x] 5.1 Update `skills/weave-ai-worker/references/delivery.md`'s merge procedure: remove step 8
      (`gh pr merge`) and the "do not run `openspec archive`" caveat tied to the old step 5 (still
      true, now simply because the worker never merges either); replace with "push your branch, then
      call `weave_ticket_merge_done` to request landing," note that mere staleness is resolved by the
      daemon with no further action from the worker, and that a rejection (real conflict, archive
      failure, or a failed required check on the archived branch) is retried the same way a rebase
      conflict already is (design.md Decisions 5 and 6). Add the retry guidance from the plan-review
      note on worker worktree divergence: since the daemon may have rebased and pushed the branch
      remotely, a worker retrying after a rejection must re-fetch and reset its local branch to the
      remote tip before resolving anything further, rather than trying to push its now-stale local
      copy (`--force-with-lease` would refuse that anyway, but the guidance saves the wasted attempt).
      Verify by re-reading the file end to end for internal consistency with the new tool contract.
      Done: rewrote steps 5, 8, 9 and added the rejection-handling paragraph (real conflict / archive
      failure / failed check / mere staleness, plus the `git fetch && git reset --hard
      origin/<branch>` reset guidance), and carved out that one case as the explicit exception to the
      "Never `git reset --hard`" rule in the file's own `## Never` section, rather than leaving a
      silent contradiction between the two.
- [x] 5.2 Update `skills/weave-ai-openspec`'s `SKILL.md` and `references/openspec-cli.md` only if their
      "never run `openspec archive`" wording needs the rationale updated (it still holds; the daemon
      still owns the only archive) — otherwise leave unchanged. Verify by checking both files still
      accurately describe who runs archive and when.
      Done: `SKILL.md`'s line was stale ("the daemon archives, in the primary clone, after it has
      verified the merge" — no longer true for the common path) and is now corrected; the "never" rule
      itself is unchanged since the worker still never runs archive. `references/openspec-cli.md`
      needed no change — it already just says archive is one of two mutating commands "which you
      never run," true either way. Also corrected the same stale claim at its source,
      `templates/worker.AGENTS.md.tmpl`'s hard rules 2 and 4 (rendered into every worker's own
      `AGENTS.md`), which the skill text otherwise would have kept contradicting.
- [x] 5.3 Run `packages/shared/src/tools.test.ts` (guards agent-facing `weave_*`/`ac_*` token usage in
      skills/templates/docs) and confirm it still passes after 5.1-5.2.
      Done: passes (14 tests), along with `prompts/render.test.ts` and `prompts/template.test.ts` (no
      golden text in either pinned the rewritten hard-rule wording).

## 6. Existing tests updated for the new ordering

- [x] 6.1 Update `packages/core/src/openspec/service.test.ts`'s `archiveAfterMerge` describe block for
      its narrowed backfill-only scope (task 4); remove or repurpose assertions that assumed it ran
      right after every merge.
      Done as part of task 4.1-4.4's own commit: the two existing tests were retargeted at
      `deliveryMode: 'local-branch'` (the scope they always actually exercised — a direct commit, no
      push), and three new tests cover the `pr`-delivery branch-and-PR path.
- [x] 6.2 Update `packages/core/src/tickets/merge-done.test.ts`: replace the VS-298
      "preserves a blocked archive's code... ticket stays `merging`" test (which assumed the git merge
      already happened) with one asserting an archive failure blocks the merge entirely (task 2.7
      covers the new-behavior test; this task removes/rewrites the now-obsolete one). Keep the
      forge-confirmed-merge-commit tests passing against the new post-merge verification call site.
      Turned out not to be obsolete, so nothing was removed: every test in this file drives its PR
      through the "already merged" branch (it pre-merges the PR in its own setup), which is exactly
      the merged-out-of-band path this change kept unchanged — including the VS-298 test, which is
      still a correct, still-passing regression test for that narrower case. The new-behavior test for
      an archive failure blocking a not-yet-merged PR is `merge-done-lands.test.ts`'s "blocks the
      merge entirely when archiving fails" (task 2.9), a genuinely different scenario living
      alongside it rather than replacing it. All 6 pre-existing tests in this file still pass
      unmodified.
- [x] 6.3 Update `packages/core/src/tickets/merge-queue.test.ts` and
      `packages/core/src/supervisor/supervisor.test.ts` (`reconcileOpenSpecArchives`,
      `reconcilePullRequests`) for the new call sequence and the PR-based backfill path.
      Verified rather than changed: both files' existing tests (24 and 81 respectively) pass
      unmodified. `merge-queue.test.ts` only exercises admission/wake mechanics, which this change
      does not touch. `reconcilePullRequests`' path to `mergeDone` is the same "already merged"
      branch as 6.2. `reconcileOpenSpecArchives`'s own tests mock `openspec.archiveAfterMerge`
      entirely (`h.services.openspec = { archiveAfterMerge } as never`) rather than exercising the
      real implementation, so they were never coupled to task 4's internal `deliveryMode` split in
      the first place and needed no change — task 4's own new tests are what actually exercise that
      split.

## 7. Full verification

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and both `pnpm test` suites (core/server and
      `packages/ui`); paste both totals verbatim per project convention.
      Done, re-verified after the captain-review fixes. `pnpm lint`: `boundaries ok` / `console ok` /
      `test fixtures ok`. `pnpm typecheck`: clean. `pnpm test`, core/server suite:
      ```
       Test Files  186 passed | 1 skipped (187)
            Tests  2860 passed | 1 skipped (2861)
         Start at  19:35:04
      ```
      `pnpm test`, UI suite:
      ```
       Test Files  99 passed (99)
            Tests  1671 passed (1671)
         Start at  19:35:15
      ```
      The one skipped core/server test predates this change and is unrelated to it.
- [x] 7.2 Confirm acceptance criterion #1 end to end with a test: a ticket merged through the normal
      flow produces exactly one commit on the landing branch containing code, `openspec/specs/**`, and
      the archived change folder.
      Done: `merge-done-lands.test.ts`'s "archives the ticket's change onto the branch and merges it
      itself when the PR is still open" — asserts the exact commit count on `main` (init + one prior
      commit + exactly one squash carrying code and archive together), the updated spec content, and
      that the pre-archive change path no longer exists at that commit.
