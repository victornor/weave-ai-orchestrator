## 1. Persisted stall/recovery state

- [x] 1.1 Add the `worker_stall_state` migration (`agent_id` PK, `ticket_id`, `attempts`,
      `first_detected_at`, `last_attempt_at`, `last_attempt_wake_id`, `escalated_at`,
      `escalation_decision_id`, `created_at`, `updated_at`) and verify the migration test suite passes
      with the new table present and correctly reversible per the project's migration conventions.
- [x] 1.2 Add a small accessor module (get/upsert/delete by `agent_id`) and verify unit tests cover
      create, read, and delete.

## 2. Config

- [x] 2.1 Add `stalledWorkerMaxAutoRecoverAttempts` (or the agreed name) to
      `WorkspaceDefaultsSchema` in `packages/shared/src/config.ts`, default 2, with a doc comment
      explaining the default the way `stalledWorkerTimeoutSec`'s comment does, and verify the config
      schema test covers the new field and its default.

## 3. Bounded automatic recovery

- [x] 3.1 Extend `stalledWorkerScan()` (or a new function it calls) so that for each worker
      `stalledWorkers()` returns: look up its `worker_stall_state` row, and if a `succeeded` run for
      that agent finished after `last_attempt_at` (or `first_detected_at`) and
      `runProducedEvidence()` is true for it, delete the row (progress reset) before proceeding.
      Verify with a test that a worker whose recovered turn left a ticket comment is no longer
      flagged and its state row is gone.
- [x] 3.2 When no reset applies and no `worker_stall_state` row exists yet, create one
      (`attempts: 0`, `first_detected_at: now`). Verify with a test that a first-time stall creates
      the row.
- [x] 3.3 When `attempts < cap`, enqueue a recovery wakeup via `wake.enqueue()` targeting the same
      `agentId`, `source: 'system'`, `payload.kind: 'stall_recovery'`, a reason naming the attempt
      number, `idempotencyKey: stall-recovery:<agentId>:<attempts+1>`; increment `attempts` and set
      `last_attempt_at`/`last_attempt_wake_id`. Verified with a test that the wakeup is enqueued and
      the attempt count increments; a *duplicate* enqueue on a second sweep tick before the run
      finishes cannot happen structurally, not just by the idempotency key — `stalledWorkers()`
      itself excludes an agent with any queued/claimed wakeup, so the scan's loop body never runs
      for it a second time until that wakeup is consumed (covered by the existing "does not flag a
      worker with a wakeup already queued" case, which applies identically to a recovery wakeup).
- [x] 3.4 Verify with a test that the recovery wakeup always targets the ticket's existing
      `agents.id`/`kind = 'worker'` row, that `tickets.worker_id` is unchanged throughout, and that
      `spawnPending()`'s sweep does not spawn or bind a second worker for that ticket at any point
      during recovery (exercising the actual sweep function, not a mock of it).
- [x] 3.5 Verify with a test covering a long-running healthy turn (a run in `running` status, however
      old its agent's `last_run_at`) that it is never selected by `stalledWorkers()` and no
      `worker_stall_state` row is ever created for it.
- [x] 3.6 Verify with tests, one per case, that a worker with an open decision, a queued future
      self-wake, or any other action-path wakeup is never selected and never gets a recovery attempt.
      Also added: a ticket in `blocked` status is excluded explicitly, since a block is not always
      represented by an open decision (a MODIFIED requirement addition to the base VS-202 predicate,
      needed for this ticket's own acceptance criterion).

## 4. Escalation

- [x] 4.1 When `attempts >= cap` and the worker is (re-)detected as stalled with no reset applying,
      raise a `gate_finding` decision via `decisions.create(..., owner: 'weaver', ticketId,
      correlationKey: stalled-worker:<agentId>)` naming the worker, the ticket and the attempt count;
      set `escalated_at`/`escalation_decision_id` on the state row; do not enqueue a further recovery
      wake. Verified with a test that the decision appears in the weaver's open decisions with the
      expected title/context/correlationKey/owner.
- [x] 4.2 Verify with a test that a second detection while the escalation decision is still open does
      not raise a duplicate decision and does not enqueue a further recovery wake — because the open
      decision also removes the worker from `stalledWorkers()`'s own result set (asserted via the
      wakeup count staying at 2, never reaching a third).
- [x] 4.3 Verify with a test that once the weaver resolves the escalation decision, the worker becomes
      eligible for detection again on the same terms as any other worker (no leftover exclusion), and
      gets a full fresh set of attempts rather than being treated as already at the exhausted cap.

## 5. Surfacing: workers and tickets reads, and the push stream

- [x] 5.1 Wire `isWorkerStalled(ctx, agentId)` into `GET /workers`, `GET /workers/:id`
      (`packages/server/src/routes/workers.ts`) and `GET /tickets/:id`
      (`packages/server/src/routes/tickets.ts`, as `workerStalled`) — the actual JSON routes the web
      app reads, in place of `packages/server/src/presenter.ts`/`agentUiStatus(...)` named in the
      design, which turned out to be the surface-adapter (tmux/hyprland) presenter, not the web app's
      API. Verified with route-level tests (`packages/server/test/workers.test.ts`) asserting a
      worker/ticket with a `worker_stall_state` row reads `stalled`/`workerStalled: true`, and one
      without reads `false`.
- [ ] 5.2 Wire the same lookup into `packages/presenter/src/views.ts`'s equivalent call site (the CLI/
      TUI-facing presenter). **Deferred** — see the delivery note: this is a distinct surface (the
      `weave presenter` reconciler for tmux/Hyprland window titles) from the web app read path this
      ticket's acceptance criteria are about, and touching it was not necessary to satisfy them.
- [x] 5.3 Push a status delta on the workspace stream when a `worker_stall_state` row is created or
      deleted. Implemented by reusing the existing `worker.stalled` event (already a registered
      `EventType`, already wired in `packages/ui/src/api/events.ts`'s `invalidateFor` to invalidate
      `qk.workers`/`qk.worker`/`qk.briefing`) rather than adding new ephemeral-broadcast plumbing —
      emitted on detection (existing), on recovery, and on an escalation resolving with no evidence.
      No new event type or UI wiring needed since the invalidation path already existed.

## 6. Full verification

- [x] 6.1 Reproduce the exact VS-495 shape end to end (a worker whose ticket is unfinished, whose last
      run succeeded, with no queued wake and no active run, and no `worker_stall_state` row yet) and
      assert: it is detected, a bounded recovery wake is enqueued, and — driving that through the cap
      — it is eventually escalated rather than retried forever.
- [x] 6.2 Run the full test suite (core/server and UI, both blocks), lint and typecheck; fix anything
      that regresses. Core/server: 242 files passed, 1 skipped (243) — 3789 tests passed, 1 skipped
      (3790). UI: 138 files passed — 1739 tests passed. `pnpm lint` and `pnpm typecheck` both clean.
