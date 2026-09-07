# Design — approval integrity for `plan` and `merge` decisions

## Context

`putDocument(actor, id, 'plan', body)` (`packages/core/src/tickets/service.ts:249`) runs an
unconditional `deps().decisions.supersedeForTarget(actor, t.id, \`plan_approval:${t.id}\`)` after
every write to the `plan` key. `transition()` calls it once, internally, right before it creates the
`plan_approval` decision (`service.ts:322`) — harmless, since nothing is open yet. Any later write to
the same key, from anywhere, closes whatever is open. The worker skill's own closing convention names
`plan` as a document workers may write, so a worker following it after requesting `proposed` destroys
its own just-created approval, and nothing surfaces the loss: `LIVENESS_STATUSES`
(`packages/shared/src/transitions.ts:43`) deliberately excludes `proposed` and `in_review`, because
an open decision *is* the ticket's action path in those statuses — the scan has no way to tell "genuinely
waiting" from "silently orphaned".

## Goals / non-goals

- **Goals.** Make the `plan` key mean one thing — the daemon's own generated plan digest — so its
  existing supersede-on-write behaviour is simply correct for everything that can still reach it.
  Make "an approval-gated status with no open approval" a state the system finds and repairs on its
  own, whatever produces it. Change no document's key or content; lose nothing already written.
- **Non-goals.** Changing how a human or the conductor answers a decision, the merge queue, or the
  YOLO auto-answer path (out of scope per the ticket). A generalised "reserved document keys"
  registry — one reserved key is what today's evidence supports; a second one can generalise the
  mechanism when it exists.

## Decisions

### Reserve `plan` at the tool/route boundary, not inside `putDocument` by actor kind

`actorFor()` (`packages/server/src/types.ts:55`) never produces `{ kind: 'system' }` for a real
request — a `run` principal maps to `agent`, everything else to `human`. So there is no live actor
value on an external call that could distinguish "the daemon" from "a worker calling the tool", and
checking `actor.kind` inside `putDocument` would either block the daemon's own call (which also
passes the requesting worker's `agent` actor through, for attribution — `service.ts:322`) or require
threading a fake system actor through `transition()` purely to satisfy the guard.

The guard instead sits at the two places an external write can arrive — `ac_ticket_document_put`
(`packages/server/src/tools.ts:230`) and `PUT /tickets/:id/documents/:key`
(`packages/server/src/routes/tickets.ts:96`) — and rejects `key === 'plan'` outright, before either
reaches `tickets.putDocument`. `putDocument` itself grows one internal-only escape: an optional
`{ system: true }` passed only from `transition()`'s own call site. This keeps the invariant in one
place per surface, keeps `putDocument`'s public signature backward compatible (an extra optional
parameter), and needs no change to `TicketsService`'s declared interface in `api.ts`.

**Rejected: narrow the supersession by ticket status** (only supersede when the ticket is
`proposing`, on the theory that's when a genuine revise-round-trip write happens). Rejected because
`transition()`'s own harmless internal write also happens while the ticket is mid-transition to
`proposed`, and re-entry after `revise` writes the new digest before the state flips back to
`proposed` — the two cases are not separable by status without adding a second signal anyway, at
which point reserving the key outright is simpler and closes the door for good rather than leaving
it ajar for the next writer who reaches for `'plan'`.

### The reserved-key error

`OcError('forbidden', "the \`plan\` document key is reserved for the daemon-generated plan digest; use \`report\` (or another key) for your own notes", { key: 'plan' })`.
`forbidden` maps to HTTP 403 (`OcError.status`, `errors.ts:19`) and reads plainly through the CLI and
the MCP tool result — a worker that still tries this (a stale skill, a habit) gets an explicit,
immediate rejection instead of a document that silently overwrote a decision.

### `repairApprovals()` lives on `TicketsService`, not the supervisor

Recreating a `plan_approval` needs `approvalOwner()`, `yolo()`, `autoApprove()` and the exact decision
shape `transition()` already builds (title, context, options, `correlationKey`, `target`) — all
private to `tickets/service.ts`. Duplicating that in `supervisor/index.ts` would drift the moment
either one changes the decision's shape. `repairApprovals()` is added next to `livenessViolations()`
and `autoMergeSweep()` — the same "the supervisor calls a tickets-service scan and acts on what comes
back" shape already established for both.

It scans two independent sets and returns what it fixed:

- `status = 'proposed' AND kind = 'change'` with no open `plan_approval` → raise a fresh one, same
  shape as `transition()`'s, `context` noting it was re-raised; under YOLO, answer it immediately
  (`autoApprove`), exactly as the original path does.
- `status = 'in_review' AND NOT auto_merge` with no open `merge_approval` → raise a fresh one. It is
  *not* auto-answered here even under YOLO: `autoMergeSweep()` already runs every tick and answers a
  pending `merge_approval` on a YOLO ticket the moment one exists, so repairing it here and letting
  the existing sweep pick it up next tick avoids a second, parallel auto-answer path.

No new decision kind, no new correlation key shape — `plan_approval:<ticketId>` and
`merge_approval:<ticketId>` are exactly what `openApproval()` already looks up and what an answer
already resolves through `applyPlanApproval` / `applyMergeApproval`
(`packages/core/src/decisions/service.ts:153,167`), so a repaired decision behaves identically to an
original one to every other part of the system.

### No race between a transition and the repair scan

Node is single-threaded and `transition()` never `await`s between writing the ticket's new status and
creating the decision for it (`service.ts:320-357`) — the only `await`s in that stretch come after
`decisions.create()` has already run. A scan interleaves only at an `await` point, so it can never
observe a ticket in `proposed` or `in_review` in the narrow window before its decision exists.

### Cadence and the conductor wake

Called on the same `LIVENESS_EVERY_MS` (60 s) cadence as `livenessScan()`, from a new
`approvalIntegrityScan()` in `supervisor/index.ts`. Nothing to repair is the overwhelmingly common
case and costs one indexed query per set; when it finds something, it wakes the conductor once, all
repaired tickets named in a single reason string, the same pattern `knowledgeHealthPass` and
`spawnPending`'s slot-wait nudge already use — one event, not one wake per ticket.

## Risks / trade-offs

- **A legitimate future use for writing `plan` externally would need a new key**, since the guard is
  a flat reject, not a role check. Nothing in this codebase or PLAN.md names one; `report` (or any
  other free-form key) already covers "a worker's own notes on a `change` ticket."
- **The repair scan papers over a *different* future bug that also drops an approval**, rather than
  surfacing it as loudly as it might deserve. Accepted: AC #3 asks for exactly this — the conductor
  is told, with the ticket named, every time the scan fixes something, so a recurring cause is still
  visible in the digest even though no single occurrence blocks anyone.

## Migration

None. `plan` is not renamed or moved; every existing document, its revisions, and
`ac_ticket_document_get` are unaffected. No schema change.
