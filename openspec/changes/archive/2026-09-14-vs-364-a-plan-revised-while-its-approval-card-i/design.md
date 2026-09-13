## Context

See `proposal.md` for why. The current shape:

- `packages/core/src/tickets/service.ts` `transition` is the only path that renders the plan and
  raises a `plan_approval`: for `proposing → proposed` it calls
  `deps().openspec.validateForProposed(t.id)`, writes the returned plan with
  `putDocument(..., {system: true})` (which supersedes any open `plan_approval`), then creates a fresh
  decision with `correlationKey: plan_approval:${t.id}` and auto-answers it under YOLO. The identical
  decision-raise is duplicated in `repairApprovals`.
- `packages/core/src/openspec/index.ts` `validateForProposed` already resolves the live worker's
  worktree (`ticketWorktree`), runs `openspec validate`, applies the capability-retirement check, and
  returns the rendered plan or the issues. Nothing calls it except the transition.
- `packages/core/src/runs/engine.ts` `executeRun` ends in a synchronous `finalize(...)`; `finalize`
  clears `execution_run_id` and marks the agent idle. `executeRun` is already async.
- A `concerns` mark holds an approving answer in `packages/core/src/decisions/service.ts` `answer`
  purely on `weaverReviewStatus === 'concerns'`; the hold lifts only when that decision stops being
  `open` (superseded by a fresh card).

The whole fix is: give the turn end the same "compare plan, write revision, raise fresh card" step the
`proposing → proposed` transition already performs.

## Goals / Non-Goals

**Goals**

- A plan revised while its ticket is still `proposed` reaches the card at the end of that turn, with
  no hand-run transition.
- Reuse the existing publication path so the revision, supersession, YOLO behavior and review wake
  are identical to a normal propose.
- Make the two review marks' meaning explicit in the shipped guidance: `concerns` holds a revision,
  build-time notes are `looked`.

**Non-Goals**

- Changing the transition graph. `proposed → proposed` stays invalid; the republish is not a
  transition and does not need one.
- Changing who owns plan approval, the override path, or the review-hold rules.
- Republishing `merge_approval` or `action_approval`; their "new commit / new revision" lifts are
  unchanged.
- Adding a schema migration, route or event type.

## Decisions

### 1. Trigger at the end of `executeRun`, not in `finalize` or a background sweep

`finalize` is synchronous and the republish needs an `openspec` child process, so the call belongs in
the async `executeRun` immediately after `finalize` returns, guarded on `agent.kind === 'worker'` and a
non-null `ticket`. All three `finalize` call sites in `executeRun` (model-unconfigured, stale
curation checkout, normal) end a turn, so each gets the same post-step via one small helper.

Alternatives: a detached task in the dispatcher's `.finally` would race the next dispatch and is
harder to test; the supervisor's periodic scan would delay the republish by up to its interval, which
is the class of delay this ticket exists to remove.

The step re-reads the ticket from the db rather than trusting the `ticket` captured at turn start,
because the worker may have moved it during the turn. It is wrapped in try/catch and only logs on
failure: a republish problem must never turn a finished run into a crashed run.

### 2. Put it on `TicketsService`, reuse the raise path

Add `republishRevisedPlan(actor, ticketId)` to `TicketsService`
(`packages/core/src/api.ts`). It writes a `plan` document, raises a decision, comments and records
activity — all tickets-service concerns — and it can call `deps().openspec.validateForProposed` for
the render/validation exactly as `transition` does. Putting it in `OpenSpecService` would force that
service to depend on decisions, comments and wakes and blur its read-only boundary.

Extract the inline plan-approval block from `transition` (the `decisions.create({kind: 'plan_approval',
...})` plus the YOLO `autoApprove`) into a private `raisePlanApproval(actor, t, opts?)`, and call it
from three places: the `proposed` transition, `repairApprovals`, and the republish. `opts` carries the
card `context` string only, so the transition keeps its wording, the repair keeps its "(Re-raised: …)"
wording, and the republish states that the plan was revised.

### 3. Compare rendered plan to the stored document, byte for byte

`validateForProposed` returns the same `renderPlan` output the transition stores. The method reads
`getDocument(ticketId, 'plan')?.body` and returns without writing when they are equal. `renderPlan` is
deterministic over the artifact files, so equality is a faithful "nothing changed" test; comparing
worktree mtimes or git state would be brittle and could miss a reverted/edited pairing.

The guard order is: ticket is `proposed` and has an `openspecChangeName` → validate → equal? no-op →
not ok? comment + wake → differing and ok? write + raise + comment + activity.

### 4. Invalid artifacts: comment and wake, never a card

On `{ok: false}` the method posts a status comment listing the issues (one line each) and enqueues a
`system` wake for the weaver via the existing private `wake()`/`conductorId()` helpers. It does not
create a `gate_finding` decision: that would add another open card to a ticket already waiting on one,
and the ticket asks for a comment and a wake, not a decision.

### 5. The guidance adds no transition, and says so

This change does **not** make `proposed → proposed` a legal transition. The worker skill text must
therefore not tell a worker whose ticket is still `proposed` to request `proposed` again — that
request is refused. It states instead that while the ticket is `proposed` a revised plan needs no
transition, because the daemon republishes it at the end of the turn; that the worker must never move
the ticket back to `proposing` by hand; and that requesting `proposed` applies only when the ticket is
already in `proposing` (the revise path, unchanged).

### 6. Ordering and supersession

The write goes through `putDocument(..., {system:true})`, whose existing logic already supersedes the
open `plan_approval`. The fresh card is created with the same `correlationKey: plan_approval:${t.id}`.
If a reverted or already-published plan reaches the turn end, the equality check sees an equal plan and
no-ops; and a fresh card always supersedes the prior one. Because the fresh decision is a different
row, VS-361's wake-on-create fires for it — no extra wake logic is needed for the "weaver hears about
the republished card" requirement; a test pins it.

## Risks / Trade-offs

- **An extra `openspec` invocation on every worker turn that ends on a `proposed` ticket.** It is two
  short child processes and only for `proposed` change tickets; the alternative (publishing without
  validating) is worse. The no-op path still validates, so a turn that changed nothing pays the same
  cost — acceptable, and it is what proves "no change".
- **A half-finished artifact edit produces a comment + wake each turn.** Visible and named rather than
  silent, and the worker's next turn can fix it; the alternative (silently keeping the stale card) is
  the bug being fixed.
- **A republish that fails (binary missing, worktree gone) must not fail the run.** Wrapped in
  try/catch with a warn log; the ticket keeps its existing card, exactly as today.

## Migration Plan

None. No schema or config change. Rollback is the revert of the change; existing open cards are
unaffected.
