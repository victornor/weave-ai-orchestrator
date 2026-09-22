## Context

See proposal.md — Why.

Steering a worker goes through several entry points, and each has its own delivery outcome today:

| Path | Entry point | Today |
|---|---|---|
| Weaver's steer | `weave_worker_message` → `workers.message(live)` (`packages/core/src/workers/index.ts:721`) | mid-turn if the run has `send`; else **queued** `conductor_request` |
| Human live-view message | `POST /workers/:id/message` → `workers.message(live, human)` | mid-turn if `send`; else interrupt (VS-254) |
| Human ticket comment / reply / channel message on a ticket | `tickets.comment` (human) → `ticket_comment` wake (`packages/core/src/tickets/service.ts:1230`) | **queued** behind a running turn |
| Human answer to a decision the worker asked | `decisions.answer` → `decision_answered` wake (`packages/core/src/decisions/service.ts:717`) | **queued** behind a running turn |
| Human reply opening a ticket with no live worker | `tickets.comment` → `followUpWithoutWorker` | relaunch/spawn; no running turn to interrupt |
| Ticketless persistent session message | `threads.inbound` | interrupt + resume (VS-657) — unchanged |
| Weaver's own chat | `threads.inbound` on the primary thread | queued — unchanged |
| Weave ticket comment (`weave_ticket_comment`) | `tickets.comment` (agent) | does not wake the worker at all — unchanged |
| System wakes (ticket assigned, retry, plan submitted, blockers resolved, timer, routine, …) | `wake.enqueue` | queued — unchanged |

`workers.message`'s live branch walks `runState(ctx).active` and takes one of three paths: `send`
present → mid-turn; no `send` and `actor.kind === 'human'` → interrupt; anything else → fall through
to a `conductor_request` wake. The conductor is an **agent** actor, so path 1 with no `send` is the
screenshot. A run has no `send` when the runtime does not declare `streamingInput` (codex, opencode,
gemini, cursor — `packages/runtimes/*/src/adapter.ts`) or before the runtime hands its handle in
`engine.ts`'s `onHandle`. The sender being an agent, not a human, is the deciding factor.

The mechanism to fix it all already exists and is exercised:

- `runs.cancel(actor, id, 'interrupt', 'message')` sets `entry.cancelled = { mode:'interrupt',
  cause:'message' }` synchronously and calls the runtime's `cancel('interrupt')`
  (`packages/core/src/runs/index.ts:156`).
- Finalize records `status:'interrupted'`, `errorCode:'interrupted_by_message'` and leaves the worker
  dispatchable — an engine test already asserts a worker resumes on the enqueued `live_interrupt`
  wake (`packages/core/src/runs/engine.test.ts:866`).
- `buildTurnPrompt` already notes "your previous turn was interrupted…" and renders a
  `live_interrupt` wake's reason whole (`packages/core/src/prompts/index.ts:543, 427`).
- The runtime layer stops a turn on `cancel('interrupt')` for every adapter (VS-660).
- VS-657 built the same shape for sessions: collect the running run inside the transaction, enqueue
  the wake, then cancel after the transaction commits (`threads/service.ts:344-427`).

The gap is that only path 2 (human, `workers.message`) interrupts, and only on a runtime with no
`send`. Paths 1, 3 and 4 queue behind a running turn.

## Goals / Non-Goals

- **Goals**: every steer of a running ticket worker is delivered immediately (mid-turn where the
  channel is open, otherwise by interrupting and resuming the same session); rapid steers coalesce;
  the outcome and the transcript label are truthful.
- **Non-Goals**: changing the ticketless-session path (VS-657), the weaver's own chat, a wake that
  carries no human or conductor words, or `live:false`; changing any runtime adapter; adding a new
  wake source, database column or config.

## Decisions

### Decision 1 — The screenshot steer was `queued` because the sender was an agent, on a runtime with no mid-turn channel

Not a defect in the wake queue or the runtime: `workers.message`'s live branch interrupts only for a
human actor. A conductor steer to a worker whose executing run has no `send` therefore falls to the
`conductor_request` branch. Reproduced in a core test that fails today (task 1.1): an agent actor, an
active run with no `send`, expecting `delivery: 'interrupted'` and a cancel carrying `cause:'message'`.

### Decision 2 — One rule for every steer: never queued behind a running turn

A **steer** is words a human or the conductor sends to a ticket-bound worker to direct its work. Every
steer path above delivers immediately. Where the executing turn has an open mid-turn channel it is
delivered into that turn; otherwise the turn is interrupted with
`runs.cancel(actor, runId, 'interrupt', 'message')` and the steer's wake — carrying the whole message
and `interruptedRunId` — starts the worker's next turn on the same runtime session.

This is the ticket's own rule, widened by captain to every sender. It needs one shared helper, because
the same three lines now appear in three services: an active-run lookup and an interrupt that skips a
run already carrying `cancelled.cause === 'message'` (`packages/core/src/runs/active.ts`).

### Decision 3 — Keep mid-turn delivery where the runtime genuinely has an open channel (claude, built-in weave)

The ticket's acceptance explicitly names "a test per runtime path (mid-turn capable and not)", so
both paths remain. Where a run has `send`, the message is already delivered immediately and in
context; stopping the turn would discard in-flight work with no latency benefit. So on claude and the
built-in runtime a `workers.message` steer (weaver or human live view) is delivered mid-turn, exactly
as VS-99 built it, and the interrupt path covers runtimes with no channel and any turn whose channel
is not open. Ticket comments and decision answers have no mid-turn channel in the code today, so on
every runtime they take the interrupt path — still immediate, never queued.

The widened scope is about **which senders** the rule covers ("any type of steering"), and it names
runtimes without an open channel as the case that queued. It does not ask to remove the mid-turn
delivery VS-99 built, and the ticket's own acceptance names both runtime paths.

Alternative considered — interrupt on every runtime including claude (captain's "interrupt, then
inject" read literally) — not chosen: it would discard a running turn's work where delivery is already
immediate, and it would undo VS-99 for no gain. The invariant captain is asking for is that a steer
never sits queued; both paths satisfy it. If captain prefers Escape semantics even where a channel is
open, that is a one-line change to this decision.

### Decision 4 — Coalescing is the cancelled-cause marker plus the wake bundle gate, as in VS-657

A second steer arriving while the first interrupt is still stopping finds the active run already
carrying `cancelled.cause === 'message'`. The shared helper does **not** cancel again; it enqueues the
second steer's own wake, and the wake bundle gate folds it into the resume the first message already
started. `flattenWakes` unpacks the bundle for the prompt, so both messages reach the one resumed
turn in order, each exactly once. This mirrors `threads/service.ts:396-398`. The boundary — once the
resumed turn has actually started, a further steer interrupts that turn under the same rule — is
stated as a spec scenario.

### Decision 5 — The outcome contract gains a truthful third value, and `live:false` is unchanged

`WorkerMessageOutcome.delivery` already has `'interrupted'` (`packages/core/src/api.ts:377`); the live
branch simply never set it for an agent. The `weave_worker_message` description is updated from
`"mid_turn" | "queued"` to name all three. An explicit `live:false` still bypasses the live branch
entirely and queues — the conductor can still choose to queue.

### Decision 6 — The ticket-comment and decision-answer paths arm the interrupt inside the transaction, cancel after it

`tickets.comment` writes inside `tx()` and `tickets/tx.ts` forbids awaiting in the callback, exactly
the constraint VS-657 handled in `threads.inbound`. Both services therefore read the active run
synchronously inside the transaction (setting the `interruptedRunId` on the wake payload) and issue
`runs.cancel` after the transaction returns, so the message's wake is already queued when the stopped
turn finalizes. `decisions.answer` is async and awaits the cancel; `tickets.comment` is synchronous
and fires it with the same `void … .catch()` the existing paths use.

### Decision 7 — The interrupted `decision_answered` prompt is rendered from its wake, not only the database

`buildTurnPrompt`'s "Answered decisions" list reads answers newer than the agent's last finished run
(`packages/core/src/prompts/index.ts:517`). When a decision answer interrupts the run, the answer is
written *before* the interrupted run finalizes, so that query excludes it and the resumed turn would
not see the answer it was steered with. The answer already rides in the wake payload
(`{ decisionId, answer: { key, text } }`); the prompt merges a `decision_answered` wake's answer into
the section, deduplicated by decision id. Without this the decision-answer steer would resume the
session but not tell it the answer — the exact failure mode this ticket exists to remove.

### Decision 8 — The transcript label gains `interrupted` so an interrupt is never shown as `queued`

The `human.input` event has recorded `delivery: 'interrupted'` since VS-254, but both transcript
renderers default every non-`mid_turn` value to `queued`
(`packages/render/src/transcript.ts:405`, `packages/ui/src/lib/transcript.ts:338`,
`packages/ui/src/components/Transcript.tsx:192`, `packages/render/src/inspect.ts:74`). This is a
latent mislabel for a human's VS-254 interrupt too. Add `'interrupted'` to `HumanInputBlock.delivery`,
map it explicitly, and render `interrupted`.

### Decision 9 — Everything else stays exactly as it is

The ticketless-session path (VS-657), the weaver's own chat, a system wake, `weave_ticket_comment`
(which does not wake the worker today), a reply that opens a ticket with no live worker (nothing is
running to interrupt), and an explicit `live:false` are untouched. The shared helper is gated to a
ticket-bound agent, so the weaver (no ticket) and a ticketless session are never affected by it.

### Decision 10 — Every runtime is covered; none queues behind a running ticket-worker turn

The runtimes that declare `streamingInput` (`claude`, `weave`) take the `send` path; the runtimes
without it (`codex`, `opencode`, `gemini`, `cursor`) take the interrupt path. VS-660 already proves
each adapter stops on `cancel('interrupt')`, so nothing "cannot be interrupted cleanly". The list and
what each does goes in the PR body.

## Risks / Trade-offs

- **[Interrupting loses work the turn had done]** → the same runtime session resumes with its
  context, the resumed turn is told it was interrupted and to verify before redoing, and the
  transcript stays visible and marked. The same trade-off VS-254/VS-657 already accept.
- **[A steer on a decision-answer interrupts an approval flow]** → the apply paths transition tickets
  and do not depend on the worker being idle; `relaunch` already cancels a running run itself, so the
  helper's cancelled-cause guard keeps the two from fighting.
- **[The decision-answer prompt gap]** → addressed in Decision 7; without it the answer would be
  silently missing from the resumed turn.
- **[A second steer starts a second turn]** → the cancelled-cause marker plus the bundle gate cover
  the stopping window, with an explicit spec scenario and a test.
- **[A claude steer is more disruptive if we interrupted it]** → we do not; `send` keeps mid-turn
  delivery there (Decision 3).
- **[The transcript label change touches a shared renderer]** → covered by render and UI unit tests
  for `mid_turn`, `interrupted` and `queued`.
- **[The conductor's own chat or a session is affected by the shared helper]** → both are gated out;
  the helper only acts on a ticket-bound worker with an executing run.

## Migration Plan

No schema or config migration. Deploy is the normal daemon upgrade; rollback reverts the commit.
Existing in-flight turns and queued wakes are unaffected.

## Open Questions

None. The one judgement the ticket delegates — whether a mid-turn-capable runtime should inject or
interrupt — is answered in Decision 3, with the reason, and both paths are specified and tested.