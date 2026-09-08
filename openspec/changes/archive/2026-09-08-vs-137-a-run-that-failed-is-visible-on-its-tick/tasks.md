## 1. The triggering agent's own work survives the pause

- [x] 1.1 In `packages/core/src/runs/engine.ts`'s `finalize()`, before the `ctx.db.transaction()`
  block, compute whether this would be the third consecutive `errorFamily === 'auth'` run for
  `f.agent.id` (this run plus its two immediately preceding runs, ordered by `created_at`, with no
  `'succeeded'` run between them) into a `authFailuresExhausted: boolean`. Verify with a focused unit
  test on the query alone if it is factored out, or as part of 1.3's tests otherwise.
- [x] 1.2 In the same transaction's wake-status write (`engine.ts:406-408`), when `errorFamily ===
  'auth'` and `!authFailuresExhausted`, update each wake to `{ status: 'queued', runId: null,
  claimedAt: null }` instead of `{ status: 'failed', runId, finishedAt: now }`. Every other family,
  and the exhausted case, keep today's unconditional `'failed'` write. Verify with a new
  `engine.test.ts` case in the existing `describe('an authentication failure gates the runtime
  instead', ...)` block: after a first auth failure, the wake that triggered the run is `status:
  'queued'` with `runId: null`, not `'failed'`.
- [x] 1.3 In `finalize()`'s branch at `engine.ts:434-435`, call `parkForHuman(ctx, deps, f,
  errorFamily, errorCode, ...)` instead of `gateRuntimeForLogin(...)` when `authFailuresExhausted` is
  true; keep calling `gateRuntimeForLogin` otherwise. Verify with a new `engine.test.ts` case: three
  consecutive auth failures on one agent (no success between them) result in a `retry_approval`-style
  per-worker decision on its ticket and the ticket `blocked`, exactly as the retry ladder's own
  exhaustion does; and confirm the runtime is still gated (the outage is real regardless of whether
  this one worker keeps resuming into it).
- [x] 1.4 Add a case proving the reset: an agent's auth failure, then a `'succeeded'` run, then
  another auth failure resumes normally (is not treated as failure #2 of a streak) — verify via
  `authFailuresExhausted` staying false and the wake being requeued, not failed.
- [x] 1.5 Extend `packages/core/src/runs/authgate.test.ts` (or add to `engine.test.ts`'s existing
  `ungateRuntime`-adjacent coverage) with an end-to-end case: an agent's turn fails to authenticate,
  the runtime is later found healthy (`ungateRuntime` runs), and the agent takes a new turn resuming
  the same ticket without a human resuming it — pinning that the requeued wake alone is sufficient,
  with no `source: 'retry'` wake anywhere in the chain (assert the existing `WHERE source = 'retry'`
  query from `engine.test.ts:634`/`:784` still returns nothing for this agent).

## 2. The conductor is told per ticket

- [x] 2.1 In `packages/core/src/runs/authgate.ts`, add `ticketId?: string | null` to
  `gateRuntimeForLogin`'s `input` parameter and pass `f.agent.ticketId` at its `engine.ts:435` call
  site.
- [x] 2.2 Inside `gateRuntimeForLogin`, add a `step('tell the conductor about this ticket', ...)`
  guarded the same way as the existing steps: when `input.ticketId` is set, look for an open decision
  with `correlationKey: \`auth-outage:${input.ticketId}\`` and, if none is open, `deps().decisions
  .create({kind:'system', id: null}, {kind:'gate_finding', owner:'conductor', ticketId:
  input.ticketId, title, context, correlationKey})` naming the ticket and saying it resumes on its
  own. Verify with a new `authgate.test.ts` case: an auth failure on an agent with a `ticketId` raises
  exactly one open `gate_finding` owned by `conductor` on that ticket; a second failure on the same
  ticket while it is open raises no second one.
- [x] 2.3 In `engine.ts`'s success path that already withdraws a stale `retry_approval`
  (`engine.ts:465-471`), widen the loop to also withdraw an open `gate_finding` whose
  `correlationKey === \`auth-outage:${f.agent.ticketId}\`` when `f.agent.ticketId` is set. Verify with
  an `engine.test.ts` case: after the per-ticket `gate_finding` is raised, the agent's next
  successful turn withdraws it.
- [x] 2.4 Verify with an `authgate.test.ts`/`engine.test.ts` case that an agent with no `ticketId`
  (a conductor, or a worker's first interactive turn before a ticket is attached) still gates the
  runtime and raises the existing workspace-level decision, with no error from the missing ticket id.

## 3. The board and the project overview show a paused worker's reason

- [x] 3.1 In `packages/ui/src/lib/board.ts`, add `pausedWorkersByTicket(workers: readonly Agent[]):
  Map<string, Agent>`, built like `liveWorkersByTicket` but keyed on `w.status === 'paused'` instead
  of `isLiveWorker(w)`. Verify with a `board.test.tsx` (or a new `board.test.ts`) case: a ticket with
  one live worker and one paused worker (different tickets) appears correctly in each map, and a
  ticket with only a paused worker is absent from `liveWorkersByTicket` but present in
  `pausedWorkersByTicket`.
- [x] 3.2 In `packages/ui/src/routes/Board.tsx`, add `const paused = useMemo(() =>
  pausedWorkersByTicket(workers.data ?? []), [workers.data])` and change `pausedFor(ticketId)` to
  check `paused.get(ticketId)` when `live.get(ticketId)` has no reason (or independently, whichever
  reads cleaner given `workerPauseReason`'s existing shape), so a paused worker's reason renders
  regardless of the live map. Verify with a `boardRoute.test.tsx` case: a ticket whose worker is
  `status: 'paused'` with a `pauseReason` shows the "paused · reason" text on its card.
- [x] 3.3 Apply the same fix to `packages/ui/src/routes/project/WorkSection.tsx`'s use of
  `liveWorkersByTicket`. Verify with a component test the same way as 3.2, scoped to that route.

## 4. The conductor's digest names the worker's status

- [x] 4.1 In `packages/core/src/briefing/service.ts`'s `underway()` query, add `a.status AS
  workerStatus, a.pause_reason AS workerPauseReason` to the `SELECT` and include both fields
  (`workerStatus`, `workerPauseReason`) on the mapped row. Add the two fields to the `Briefing`
  type's `underway` entry shape in `packages/shared`. Verify with a `briefing.test.ts` case: a ticket
  whose worker is `paused` with a pause reason shows both in its `underway()` row, and one whose
  worker is `active` shows `workerStatus: 'active'` and `workerPauseReason: null`.
- [x] 4.2 Confirm (with a test, not just a read of the code) that wherever the digest is rendered
  into the conductor's prompt (`packages/core/src/prompts` or equivalent), the new fields are surfaced
  in the text for a paused worker — not merely present on the JSON snapshot the prompt is built from.

## 5. The credential-freshness failure message is honest

- [x] 5.1 In `packages/core/src/runs/credentialFreshness.ts`, change `refresh()`'s failure branch to
  build its message from both `description` and the local `facts` (the `readCredential()` result
  already computed at line 57): keep using `description.note` only when `description === null` or
  `description.billingType === 'unknown'`; otherwise compose a message stating the account described
  successfully (naming its `billingType`) and that the local credential is not currently confirmed
  valid (naming whether it is present at all). Verify with a `credentialFreshness.test.ts` case:
  a `describeAccount` returning `billingType: 'metered_api'` with its real note produces a recorded
  message that does not contain that note's text and instead names the billing type and the local
  credential's state.
- [x] 5.2 Add a `credentialFreshness.test.ts` case for `billingType: 'unknown'` (the existing
  probe-timeout/probe-failure shape) proving its message is unchanged from today — this fix narrows
  the unconditional case, it does not touch the already-correct one.
- [x] 5.3 Confirm no other reader depends on the exact prior wording of this message (grep
  `credential_refresh_failed`'s message across `packages/core`, `packages/server`, `packages/ui`) and
  update any snapshot/fixture that pins the old text.

## 6. Docs and verification

- [x] 6.1 Run `openspec validate vs-137-a-run-that-failed-is-visible-on-its-tick --json --strict` and
  fix anything it reports.
- [x] 6.2 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 6.3 In the PR description, state plainly what a human now sees, in each view (worker page,
  ticket detail, board card, project overview, conductor digest, command line), for a ticket whose
  worker is paused for a runtime login outage — per the ticket's own Verification section — and
  confirm the three-strikes cap and the honest freshness-check message with the exact test names that
  cover them.
