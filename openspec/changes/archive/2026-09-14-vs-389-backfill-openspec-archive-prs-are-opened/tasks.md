## 1. Confirm and record the cause

- [x] 1.1 Confirm from `main` that VS-334's archive commit `33034d7d`, VS-338's `a4e4c8da` and VS-339's `f762600b` are reachable only from their `ac/archive-*` branches (children of each ticket's own merge commit, not ancestors of `HEAD`), which shows the in-merge archive did not run and the post-merge `archiveAfterMerge` backfill did; note in the ticket report that the path remains reachable on the current release for any pull request merged outside `mergeDone`.

## 2. Persist the pending backfill pull request on the ticket

- [x] 2.1 In `packages/core/src/openspec/index.ts` `archiveAfterMerge`, for the `pr` delivery path persist `deliveryJson.openspecArchive = { changeName, pendingPrUrl, state: 'pending' }` on the ticket on each of its three return paths (an open pull request found, a pull request created from the existing branch, a pull request created after the archive commit was pushed), keeping the existing `ticket.updated` emit; verify in `packages/core/src/openspec/service.test.ts` that the ticket row's `delivery.openspecArchive.pendingPrUrl` is set after the call.
- [x] 2.2 Make the `pr` path's return carry `{ changeName, branch, pendingPrUrl }`, and in `packages/core/src/tickets/service.ts` `mergeDone` keep the returned pending pull request instead of discarding it; verify in `merge-done*.test.ts` that a backfilled pending pull request reaches the ticket's delivery.
- [x] 2.3 Clear or complete the pending mark when the change is already archived (`archivedDirFor` finds it) and, after a successful archive landing, set `deliveryJson.openspecArchive = { changeName, prUrl, state: 'landed', archivedAs }`; verify with a test that a landed archive leaves no `state: 'pending'`.

## 3. Raise the merge approval

- [x] 3.1 Add an explicit opt-in field to `DecisionCreateInput` (e.g. `attachToTerminal?: boolean`) and, in `packages/core/src/decisions/service.ts` `create`, keep the ticket attachment for a `merge_approval` whose `target` names an archive backfill when it is set; verify a decision test that such a card on a `done` ticket has a non-null `ticketId`, while an ordinary decision on a terminal ticket is still detached.
- [x] 3.2 Give the archive card the correlation key `merge_approval:archive:<ticketId>:<changeName>` and an `target.archive` of `{ changeName, branch, prUrl, number }`; verify no other merge approval is superseded by it and it is not superseded by a ticket's own merge card.
- [x] 3.3 Add a helper that raises the archive card (human-owned, options from `NAMED_CARD_OPTION_KEYS.merge_approval`, context naming the pull request) and verify it creates exactly one open card and that the weaver is woken for review.

## 4. Answer path: land the archive

- [x] 4.1 Add a tickets-service method (e.g. `landArchiveBackfill`) that, under the project `landLock`, calls `attemptArchiveThenMerge` with the archive branch, change name, pull request URL and the project's merge method; on `merged` record the archive on the ticket's delivery and comment, and on `conflict`/`checks_pending`/`checks_failed` record the outcome on the ticket and return without throwing.
- [x] 4.2 In `applyMergeApproval` (`packages/core/src/decisions/service.ts`), branch on `target.archive` to call `landArchiveBackfill` instead of transitioning the ticket to `merging`, so the ticket stays `done`; verify with a decisions test that an approve lands the archive and never transitions the ticket.
- [x] 4.3 On a `changes` answer for an archive card, record the human's reason on the ticket and store the declined pull request URL in the ticket's delivery (`openspecArchive.declinedPrUrl`), merging nothing; verify the answer records and does not merge.
- [x] 4.4 Verify that with YOLO off an open archive card is never merged until answered approve, and that a stale archive branch is rebased before merging (fake forge + temp repo).

## 5. Reconciliation sweep: convergence, retry, closed pull request

- [x] 5.1 Extend `reconcileOpenSpecArchives` (`packages/core/src/supervisor/index.ts`) to raise the card for a finished ticket whose change is unarchived and whose `archiveAfterMerge` result names an open pull request with no open card; skip a pull request a `changes` answer declined; verify a sweep test raises the card for a pre-existing open archive pull request.
- [x] 5.2 Add the retry of an archive card answered `approve` whose change is still unarchived, reusing `recordReconcileArchiveFailure` for a standing failure; verify a conflict/pending outcome is retried and a standing failure comments and wakes the weaver once.
- [x] 5.3 When the project runs under YOLO, the sweep answers the raised archive card itself and lands it; verify YOLO on lands and YOLO off waits.
- [x] 5.4 Detect a closed-unmerged pull request on the archive branch via the optional `listPullRequests` (`headRefName`/`state`), record `openspec.archive_pr_closed` on the ticket, and open a fresh pull request whose own card is raised; verify with a fake forge that a closed pull request is recorded, a fresh one opened, and the closed one not reopened.

## 6. Visibility

- [x] 6.1 Render a "spec archive pending" mark with the pull request link from `ticket.delivery.openspecArchive` on the V2 ticket detail (`packages/ui/src/v2/ticket/Ticket.tsx`); verify with a component test that a pending archive shows the link and a landed/absent one does not.
- [x] 6.2 Render the same mark on the V2 Work board card (`packages/ui/src/v2/work/Work.tsx`); verify with a component test.
- [x] 6.3 Update the ticket delivery description in `docs/PLAN.md` §(schema table) to name `openspecArchive` alongside `branch`/`prUrl`/`prState`, and `docs/API.md` if it lists delivery fields.

## 7. Verification

- [x] 7.1 Run `openspec validate vs-389-backfill-openspec-archive-prs-are-opened --json --strict` and fix every reported item.
- [x] 7.2 Run `pnpm lint && pnpm typecheck` and fix every failure.
- [x] 7.3 Run the suites with `XDG_CONFIG_HOME="$(mktemp -d)" pnpm test` (both the core/server and the UI suites) and paste both suite blocks verbatim in the report; do not add them together and do not claim both if only one ran.
- [x] 7.4 Confirm no test or command touched live GitHub or the real pull requests #282, #313 or #314, and that no test ran the live daemon, a systemd unit or port 7433.
