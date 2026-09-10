## 1. Config

- [x] 1.1 Add `stalledWorkerTimeoutSec: z.number().int().min(60).default(300)` to
  `WorkspaceDefaultsSchema` in `packages/shared/src/config.ts`, with a doc comment referencing VS-202
  and explaining the 5-minute default (design.md Decision 3). Verify with `pnpm typecheck` and by
  confirming `WorkspaceConfigSchema.parse({...}).defaults.stalledWorkerTimeoutSec === 300` for a
  config with no `defaults` override.

## 2. Detection pass

- [x] 2.1 Add a `stalledWorkerScan()` function to `packages/core/src/supervisor/index.ts` that queries
  for worker agents matching every condition in
  `worker-supervision/stalled-worker-detection`'s first Requirement (not retired, ticket not
  terminal, no open decision on the ticket, no queued/claimed wakeup, no queued/running run,
  `last_run_at` older than `ctx.config.defaults.stalledWorkerTimeoutSec`). Verify with a unit test in
  `supervisor.test.ts` seeding exactly the VS-199 shape (a worker, a run `succeeded` well past the
  threshold, no wakeup, ticket `in_progress`) and asserting the function's return set contains that
  agent.
- [x] 2.2 For each match, emit a `worker.stalled` event (`ctx.events.emit('worker.stalled', 'agent',
  agent.id, { reason: 'idle', ticketId, lastRunAt })`) and a `log.warn`, deduped in memory per
  `(agentId, lastRunAt)` so the same stall is not re-reported every sweep (design.md Decision 4).
  Verify with a `supervisor.test.ts` case asserting exactly one `worker.stalled` event is emitted
  across two consecutive `supervisor.tick()` calls for the same still-stalled agent, and a second one
  after `last_run_at` moves (a new run) and the agent stalls again.
- [x] 2.3 Wire `stalledWorkerScan()` into `tick()` inside the existing `if (Date.now() - lastLiveness >
  LIVENESS_EVERY_MS)` block, alongside `livenessScan()`/`approvalIntegrityScan()`, wrapped in its own
  try/catch so a failure there cannot break the rest of the tick. Verify with a `supervisor.test.ts`
  case that a thrown error from the scan does not fail `supervisor.tick()`.
- [x] 2.4 Confirm, with a `supervisor.test.ts` case, that emitting `worker.stalled` from the new pass
  reaches the conductor through the existing digest path with no additional wiring (the event type is
  already in `DIGEST_EVENT_TYPES`) — assert `conductorDigest`'s wake payload includes the new event
  after a tick that both stalls a worker and runs the digest.

## 3. Healthy-state coverage

- [x] 3.1 Add a `supervisor.test.ts` case: a worker with a `running` run is never flagged, whatever its
  `last_run_at`.
- [x] 3.2 Add a `supervisor.test.ts` case: a worker whose ticket has an `open` decision is never
  flagged, even past the threshold.
- [x] 3.3 Add a `supervisor.test.ts` case: a worker with a `queued` or `claimed` wakeup is never
  flagged, even past the threshold.
- [x] 3.4 Add a `supervisor.test.ts` case: a worker whose ticket is `done` (or `cancelled`) is never
  flagged, even past the threshold and with no run/decision/wakeup.
- [x] 3.5 Add a `supervisor.test.ts` case: a worker whose last run finished less than the threshold ago
  is never flagged, all other conditions held constant.

## 4. Non-worker exclusion

- [x] 4.1 Add a `supervisor.test.ts` case seeding a conductor-shaped agent row (`kind: 'conductor'`,
  `ticketId: null`) with a very old `last_run_at` and asserting it is never flagged — confirming the
  design.md non-goal that only workers can reach this state, since the join on `agent.ticket_id =
  ticket.id` structurally excludes a null-ticket agent.

## 5. Existing watchdog untouched

- [x] 5.1 Run the existing watchdog test cases in `supervisor.test.ts` unmodified and confirm they
  still pass with no changes to their assertions or setup, demonstrating this change added an
  independent pass rather than altering `watchdog()`.

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 6.2 Re-read the ticket's acceptance criteria (VS-202) against the final diff and state in the PR
  description which task covers each of the six criteria, plus the answer to the ticket's question
  about other agent kinds reaching this state (task 4.1 / design.md Non-Goals).
