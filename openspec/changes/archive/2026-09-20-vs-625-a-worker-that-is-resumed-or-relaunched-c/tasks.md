## 1. Close a decision as superseded with a reason

- [x] 1.1 In `packages/core/src/decisions/service.ts`, add `supersede(actor, id, reason)`: refuse a
  decision that is not `open` (`wrong_status`), set `status: 'superseded'` and `answerText: reason` in
  one `tx`, record a `decision.superseded` activity carrying the reason, and emit
  `decision.superseded`. Export it on `DecisionsService` in `packages/core/src/api.ts` with a comment
  saying it is the close for a card the situation has overtaken, distinct from the correlation-key
  supersede `create()` performs.

- [x] 1.2 Add `supersedeWorkerStopCards(actor, workerId, reason): number` to the decisions service:
  list the open decisions and supersede each one that is a `retry_approval` whose
  `target.agentId` is `workerId`, or a `gate_finding` whose `correlationKey` is
  `stalled-worker:<workerId>`. Return the count. Leave every other kind, and every other worker's
  cards, untouched.

- [x] 1.3 In `packages/core/src/decisions/decisions.test.ts`, cover `supersede`: an open decision
  becomes `superseded` with the reason recorded; a non-open decision is refused; an answered
  `retry_approval` is never changed; and `supersedeWorkerStopCards` closes a parking card and a
  stalled-worker finding for the named worker while leaving an unrelated open card alone.

## 2. Put the worker back to work closes its stop cards

- [x] 2.1 In `packages/core/src/workers/index.ts`, in `resume()`, after the agent is cleared to
  `active`, call `supersedeWorkerStopCards` with a reason naming the actor and the instant (for
  example `the worker was resumed by the weaver at <time>`), wrapped so a failure to close can never
  block the resume. In `relaunch()`'s non-paused branch, do the same with a relaunch reason.

- [x] 2.2 In `packages/core/src/supervisor/index.ts`, in `bootRecovery()`, close the recovered
  agent's stop cards with the reason `the worker was resumed after a daemon restart at <time>` after
  it is set `active`.

- [x] 2.3 In `packages/core/src/workers/workers.test.ts`, cover: resuming a parked worker with an
  open `retry_approval` closes it (status `superseded`, note names the resume); the same for the
  weaver's `relaunch` of a parked worker; a worker that fails again after the resume raises a fresh
  card; and resuming a worker with an open `stalled-worker:<agentId>` `gate_finding` closes it.

- [x] 2.4 In `packages/core/src/supervisor/supervisor.test.ts`, cover that `bootRecovery` closes an
  open `retry_approval` for an agent whose interrupted run it recovers. A fresh-card check after a
  resume also lives in `packages/core/src/runs/engine.test.ts`.

## 3. A late answer starts nothing

- [x] 3.1 In `packages/core/src/decisions/service.ts`, guard `applyRetryApproval`: read the target
  agent's status first; when it is not `paused`, take no action that starts work — no `relaunch`, no
  retry wake, no catalog switch — for any answer (cancel included), and record the no-op as a
  `decision.retry_stale` activity plus a `status` ticket comment naming that the worker was already
  running so nothing was started. The paused path is unchanged.

- [x] 3.2 Cover the stale answer where the side effect lives
  (`packages/core/src/decisions/decisions.test.ts`, beside the existing retry-answer tests): an
  answer to a `retry_approval` card whose worker is already `active` with the retry option enqueues
  no wake and calls no relaunch; with a deferred-retry option books no retry wake; with a
  catalog-switch option leaves the ticket's option unchanged; with cancel cancels nothing; and each
  leaves the explanatory comment. A card whose worker is still parked still acts as before.

## 4. Verify the card leaves the UI

- [x] 4.1 Add a `retry_approval` case to the decision-cache patching tests
  (`packages/ui/src/test/events.test.tsx`): a `decision.superseded` event removes that card from a
  query filtered to `{ status: 'open', owner: 'human' }` without a refetch — the query Needs you
  reads.

- [x] 4.2 Rendered evidence in `packages/ui/src/test/v2needs.test.tsx`: a `retry_approval` card is
  shown in the Needs you list while the daemon returns it open, and is gone once the open query no
  longer returns it — the state the daemon reaches when it supersedes the card on resume. A live
  screenshot was not taken (no browser harness in the repo and no scratch-daemon screenshot path);
  the 4.1 and 4.2 UI tests plus the core tests are the evidence.

## 5. Checks and knowledge

- [x] 5.1 Run `pnpm lint && pnpm typecheck`, then one full `pnpm test` at a time with
  `--maxWorkers=4`; paste both suite blocks verbatim in the ticket report.
- [x] 5.2 Record the audit outcome (D4) and the empty-turns finding as a ticket comment naming the
  two gaps left unfixed — the finding is not fixed here.
