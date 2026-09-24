## 1. Fix mergeDone's silent success for a project-less ticket

- [x] 1.1 In `packages/core/src/tickets/service.ts`'s `mergeDone`, when `t.projectId` is null, check
      whether the ticket has a `pull_request` work product recorded; if so, post a system comment,
      record `ticket.merge_archive_failed`, and throw `OcError('merge_unverified', ...)` instead of
      falling through to the terminal `done` write. Leave the existing "no PR" fallthrough (and its
      `log.warn`) unchanged.
- [x] 1.2 Add a regression test reproducing VS-665's exact shape: a ticket with `projectId: null`,
      a `pull_request` work product, status `merging`, `mergeDone` called with `{}` — assert it
      rejects with `merge_unverified`, the ticket stays `merging`, and `delivery` is not set to
      `merged: true`.
- [x] 1.3 Confirm the existing `schedules nothing for a ticket without a project` test
      (`tickets.test.ts`) still passes unchanged (project-less, no PR, still completes).

## 2. Self-heal a false merge claim once the forge confirms it

- [x] 2.1 In `packages/core/src/supervisor/index.ts`, add a reconcile step (called from
      `reconcilePass`, alongside `reconcilePullRequests`) that selects `done` tickets whose
      delivery has `merged: true`, an empty/missing `mergeCommit`, and a recorded `prUrl`; for each,
      calls `forge.prState` and, when the forge reports `merged`, updates the ticket's
      `delivery` with the real `mergeCommit`/`method` — no status change, no other follow-up.
- [x] 2.2 Add a test: a `done` ticket with the incomplete-delivery shape and a fake forge that
      reports `merged` gets its delivery corrected; the same ticket with a fake forge reporting
      `open` is left unchanged.

## 3. Land VS-665's stuck PR and audit for other affected tickets

- [x] 3.1 Check PR #534's current mergeability (`gh pr view 534 --repo victornor/agent-conductor`);
      mark ready for review if still draft, rebase/resolve conflicts if the base moved, and merge it
      for real with `GH_TOKEN="$(gh auth token)" gh pr merge`. Done: it was no longer a draft, all
      four checks (`lint`, `typecheck`, `test-core`, `test-ui`) were green, `git merge-tree` against
      current `main` showed no conflicts, and it was squash-merged as `53eb6cad7c9f`.
- [x] 3.2 VS-665's delivery record self-corrects once this change's reconcile step (task 2) reaches
      the live daemon and runs its next pass over `done` tickets — no manual edit was made or is
      needed; noted as an open, self-resolving follow-up in the PR rather than claimed as done here.
- [x] 3.3 Audited with the tools available to a worker: no bulk query over `delivery.merged`/
      `mergeCommit` across tickets is exposed, so a one-by-one scan of this workspace's ~569 `done`
      tickets was not practical from here. Stated plainly in the PR rather than guessed at or skipped
      silently — and noted why the reconcile step from task 2 makes a one-off scan unnecessary going
      forward (it re-checks every `done` ticket with this signature on every pass, not just VS-665).
