## 1. Record the retry link so the ladder is countable

- [x] 1.1 In `claim` (`packages/core/src/runs/dispatcher.ts`), read `retryOfRunId` from the payloads
  of the wakes being claimed — the last one that carries a non-empty string — and pass it as
  `retryOfRunId` on the `runs` insert inside the same transaction. A claim with no such payload
  inserts null, exactly as today. Add a short comment saying that this is the only writer of
  `runs.retry_of_run_id` and that `countRetries` in `engine.ts` is the only reader.

- [x] 1.2 In `packages/core/src/runs/engine.test.ts` (or a new `dispatcher.test.ts` beside it), prove
  the link: a wake enqueued with `source: 'retry'` and `payload: { retryOfRunId: <id> }` produces a
  run whose `retry_of_run_id` is that id; a wake with any other source and no such payload produces a
  run whose `retry_of_run_id` is null; and a claim that coalesces a retry wake with an ordinary wake
  still records the link.

- [x] 1.3 Add a test that a chain of three linked runs makes `countRetries` return 3, and that a
  chain longer than the 10-hop cap terminates rather than spinning.

## 2. End the transient ladder after three attempts

- [x] 2.1 Un-skip / complete the staged ladder test in `packages/core/src/runs/engine.test.ts`
  ("raises the card once the retry ladder is spent") so it drives real linked runs through the
  dispatcher rather than writing `retry_of_run_id` by hand, and asserts that the fourth
  `transient_upstream` failure schedules no retry wake and parks the worker.

- [x] 2.2 Add the companion test: the first, second and third `transient_upstream` failures each
  schedule exactly one retry wake with `not_before` at roughly 30 s, 2 min and 10 min, and none of
  them parks the worker or raises a card. This pins that the timings are unchanged.

## 3. Take a usage limit out of the ladder

- [x] 3.1 In `packages/core/src/runs/engine.ts`, change `RETRYABLE` to `['transient_upstream']` and
  update the comment above it and above the retry block so both say that a usage limit parks on its
  first failure. Confirm by reading the finalize branch that `provider_quota` now falls into the
  non-retryable parking branch with `agentStatus` still resolving sensibly for a paused worker.

- [x] 3.2 Add a test proving the first `provider_quota` failure schedules no retry wake at all,
  pauses the worker, blocks the ticket and raises exactly one `retry_approval` card.

- [x] 3.3 Write `docs/adr/0010-quota-failures-do-not-retry.md` recording the deviation: what
  `docs/PLAN.md` §7.2 step 8 said, what the system does now, and the reasoning from design.md
  (a quota is not transient; three more attempts are guaranteed waste and reach the same card).
  Correct the ladder sentence in `docs/PLAN.md` §7.2 step 8 to name `transient_upstream` only, with
  a pointer to the ADR.

## 4. Record why a paused worker stopped

- [x] 4.1 Add `packages/db/src/migrations/0011_agent_pause_detail.sql`: one `ALTER TABLE agents ADD
  COLUMN pause_detail_json TEXT` with a header comment saying it is additive, nullable and
  backfill-free. Verify on a fresh database that `PRAGMA table_info(agents)` gains exactly that
  column and that re-opening is a no-op.

- [x] 4.2 In `packages/db/src/migrations.test.ts`, prove the migration against a database seeded
  through the earlier schema with an active worker, a paused worker carrying a free-text
  `pause_reason`, and a retired worker: all three survive with every existing field unchanged and a
  null `pause_detail_json`, and `PRAGMA foreign_key_check` returns no rows.

- [x] 4.3 In `packages/shared/src/types.ts`, add `AgentPauseDetail { family: RunErrorFamily | null;
  code: string | null; message: string | null; resetAt: string | null; runId: string | null }` and
  `pauseDetail: AgentPauseDetail | null` on `Agent`. Update `packages/ui/src/test/factories.ts` and
  `packages/render/src/entities.test.ts` so their agent fixtures carry the new field.

- [x] 4.4 In `parkForHuman` (`packages/core/src/runs/engine.ts`), write `pauseDetailJson` alongside
  `pauseReason` in the "pause the agent" step, carrying the family, the runtime's code, the runtime's
  message (bounded the way the card's context already bounds it) the parsed reset time and the run
  id. Keep `pauseReason` as the one-line human string it is today.

- [x] 4.5 Clear `pause_detail_json` everywhere the pause ends: `workers.resume` and `workers.pause`
  in `packages/core/src/workers/index.ts`, every branch of `applyRetryApproval` in
  `packages/core/src/decisions/service.ts`, and the finalize path in `engine.ts` that sets an agent
  back to `active` after a successful turn. Add a test that a worker which recovers on its own has
  neither a pause reason nor a pause detail left.

## 5. Offer the reset time instead of booking it

- [x] 5.1 In `parkForHuman`, delete the "book the quota retry" step. When `parseResetTime` returned a
  time, add a `retry_at_reset` option to the card labelled with that time in UTC, recommend it, and
  say in the card's context that nothing will run until the human chooses. When no reset time is
  known, leave today's `retry_1h` option and recommendation exactly as they are.

- [x] 5.2 In `applyRetryApproval` (`packages/core/src/decisions/service.ts`), handle
  `retry_at_reset`: read the reset time from the agent's `pause_detail_json` (falling back to an hour
  out if it is missing), resume the worker with a wake whose `not_before` is that time and whose
  idempotency key is `retry_at_reset:<decisionId>`, and clear the pause detail.

- [x] 5.3 Tests: a quota failure whose message names a reset time produces a card carrying
  `retry_at_reset` as the recommendation and schedules no wake; answering `retry_at_reset` schedules
  exactly one wake at that time; leaving the card unanswered leaves the worker with no queued wake at
  all. A quota failure with no parseable reset time still produces today's `retry_1h` card.

## 6. Make resume put the worker back to work

- [x] 6.1 In `workers.resume` (`packages/core/src/workers/index.ts`): clear `pauseReason` and
  `pauseDetailJson`, set `status: 'active'`, enqueue a wake (`source: 'system'`, reason `resumed`,
  idempotency key `resume:<agentId>:<turnEpoch>`), keep the existing activity record and
  `worker.status` event. When the worker has a ticket in `blocked`, transition it to `in_progress`
  when an execution run is held and `todo` otherwise — the same rule `applyRetryApproval` uses — and
  wake the conductor with the fact that the worker resumed. Every step guarded on its own so one
  failure does not take the others with it, as `parkForHuman` does.

- [x] 6.2 In `workers.relaunch`, when the worker is `paused` and carries a `pause_detail_json`,
  delegate to `resume` and return, without bumping `briefRevision` or re-rendering the home. Leave
  the relaunch path for `error`, `active` and human-paused workers unchanged.

- [x] 6.3 Tests in `packages/core/src/workers/workers.test.ts`: resuming a paused worker clears both
  pause fields, queues exactly one wake, leaves the worktree row and branch untouched and moves a
  blocked ticket back; resuming an already-active worker queues nothing new; relaunching a
  quota-paused worker takes the resume path and does not bump `briefRevision`; relaunching an `error`
  worker still takes the old path.

## 7. Show the reason on every surface

- [x] 7.1 In `packages/render/src/entities.ts`, derive one `pauseReason` string on
  `WorkerCardModel` — `<family> · <message>` with the reset time appended when known, falling back to
  the agent's free-text `pause_reason`, and null when the worker is not paused. Add it to `meta` for
  a paused worker. Cover it in `packages/render/src/entities.test.ts`, including the fallback and the
  not-paused cases.

- [x] 7.2 `packages/ui`: show that string on `WorkerCard` and `WorkerRow`
  (`packages/ui/src/components/WorkerCard.tsx`), on the Team page's worker rows
  (`routes/Team.tsx`), on the board's ticket card and row when the ticket's live worker is paused
  (`components/TicketCard.tsx`, `routes/Board.tsx` — `liveWorkersByTicket` already carries the
  agent), on the ticket page's status line (`routes/TicketPage.tsx`) and on the worker page
  (`routes/WorkerPage.tsx`).

- [x] 7.3 `packages/ui`: add a Resume button beside the existing Relaunch on `WorkerPage`, on the
  Team page's paused worker rows and on `TicketPage` when the ticket's worker is paused, all through
  the existing `useWorkerAction` `resume` action. Re-run the whole ui suite after the change: the
  route tests mock `../api/hooks` wholesale and any new hook usage breaks them.

- [x] 7.4 `packages/cli/src/commands/worker.ts`: add a `REASON` column to `worker list` populated
  from the card's `pauseReason` (empty for a worker that is not paused) and a `paused` field to
  `worker show`. `conductor worker resume <id>` already exists and needs no change; verify it now
  causes a turn.

- [x] 7.5 Add ui tests for a paused worker: the reason renders on the worker card and on the board
  card, a Resume button appears and calls the resume action, and a paused worker with only a
  free-text reason renders that text with no empty family. Add a CLI test that `worker list` prints
  the reason column.

## 8. Tell the conductor it is blocked, not stalled

- [x] 8.1 In `buildTurnPrompt` (`packages/core/src/prompts/index.ts`), for the conductor's "Open
  work" lines, render a worker whose status is `paused` with a pause detail as
  `— <name> (paused: <family> — <message>; the human owns the resume)` instead of
  `— <name> (paused)`. Leave every other status line as it is.

- [x] 8.2 Update `skills/agent-conductor-conductor/SKILL.md` where it tells the conductor to relaunch
  a stuck worker: a worker paused waiting on a human is blocked on the human, not stalled — relaunch
  is a resume and answering the card is the human's move.

- [x] 8.3 Add a `packages/core/src/prompts/render.test.ts` case asserting the paused line names the
  family and the message, and that a worker paused without a detail keeps the plain form.

## 9. Verify

- [x] 9.1 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @agent-conductor/core exec vitest run`,
  `pnpm --filter @agent-conductor/server exec vitest run`, `pnpm --filter @agent-conductor/cli exec
  vitest run` and `pnpm --filter @agent-conductor/ui exec vitest run` all green. Run the ui suite
  separately: the root `pnpm test` chains packages with `&&` and its summary is easy to miss.

- [x] 9.2 `openspec validate vs-56-worker-failures-stop-instead-of-retrying --strict` clean from the
  repo root, and every task above ticked only where the behavior is fully implemented.
