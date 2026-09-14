## 1. Self-wake replacement

- [x] 1.1 Fix `scheduleSelfWake` in `packages/core/src/wake/index.ts` so it cancels the worker's queued self-wake and releases the stable `self-wake:<agentId>` idempotency key from every other self-wake row for that agent (`claimed`, `completed`, `failed`), then inserts the new queued row. Verify: `wake.test.ts` gains cases where the first schedule is `claimed`, and where it is `completed`, each asserting a second schedule leaves exactly one queued self-wake (the second id), no throw, and the first row no longer holds the key.
- [x] 1.2 Confirm the existing "replaces the pending self-wake" and delay-bound tests still pass unchanged. Verify: `pnpm vitest run packages/core/src/wake`.

## 2. Wake the merge-slot worker when checks resolve

- [x] 2.1 Add optional `mergeState` and `isDraft` to `ForgeAdapter.prState` in `packages/plugin-sdk/src/index.ts`, and read `mergeStateStatus,isDraft` in `packages/core/src/forge/gh.ts` (map `CLEAN` → `clean`, `BLOCKED` → `blocked`, lowercased otherwise). Verify: a gh-mapping unit test rounds a recorded `mergeStateStatus`/`isDraft` through `prState`'s parser without calling GitHub.
- [x] 2.2 Add `wakeMergingOnProgress` in `packages/core/src/supervisor/index.ts`, called from `tick()`, selecting only tickets with `status = 'merging' AND merge_started_at IS NOT NULL` that have a pull request and a ready clone, and throttling each ticket's forge call to ~30 s. It writes `ciState`/`ciStateAt`/`ciHead`/`prChecks`/`prState` and any `mergeState`/`mergeStateHead`/`isDraft` onto the delivery, emits `ticket.updated` when the CI state changes, and enqueues a `merge_approved` wake to the ticket's live worker on a resolved-check or clean transition, keyed `merge-ci:<ticketId>:<head>:<state>` / `merge-state:<ticketId>:<head>:<state>`. Verify: `supervisor.test.ts` covers pending → success waking once, a second pass with no change not waking again, pending → failure waking with the failure, a head change re-arming, and a clean merge-state transition.
- [x] 2.3 Guard the wake conditions against the reviewer's cases. Verify: tests prove a queued merging ticket (`merge_started_at IS NULL`) is never polled, `blocked` with pending checks produces no wake, and a draft pull request with no checks produces no wake.
- [x] 2.4 Confirm the pass does not run the hourly reconcile's project fetch and does not throw when the forge is missing or errors. Verify: a test where `prState` rejects leaves the delivery unchanged and `tick()` resolves.

## 3. Show the active merge's wait

- [x] 3.1 Add `ciState` and `ciStateAt` to `MergeQueueEntry` in `packages/core/src/api.ts` and populate them in `packages/core/src/tickets/merge-queue.ts` from the ticket delivery, and to the UI types in `packages/ui/src/api/types.ts`. Verify: a merge-queue test reads an active entry and sees the stored CI state and stamp; it is null when never observed.
- [x] 3.2 Render the phase and duration (waiting on CI vs on the worker) in the merge queue view's active entry and in the board/V2 Work merge line via `mergeStrip`. Verify: a `MergeQueueEntry` with `ciState: 'pending'` renders an "on CI" wait and one with a resolved state renders an "on the worker" wait, in both the view and the strip.
- [x] 3.3 Update the merge-queue response shape in `docs/API.md`. Verify: the documented `MergeQueueEntry` names the new fields.

## 4. Verification

- [x] 4.1 Rebase onto `main` if it has moved, resolving any collision with VS-389 in `packages/core/src/supervisor/index.ts`, and confirm the supervisor tests still pass.
- [x] 4.2 `pnpm lint` and `pnpm typecheck` are green.
- [x] 4.3 Run the core/server and UI suites separately with a throwaway config home, `XDG_CONFIG_HOME="$(mktemp -d)" pnpm test`, and paste both suite blocks verbatim in the report — never one block labelled as both.
