## Context

Two defects from VS-305's audit, both with a query behind them.

**Defect 1 — a decision created on an already-terminal ticket never closes.** `propagateTerminal()`
withdraws a ticket's open decisions when it reaches `done` or `cancelled`
(`packages/core/src/tickets/service.ts:376-382`, reached from `transition()`, `cancel()` and
`mergeDone()`). That part works. The gap is at creation: `decisions.create()` checks only that the
ticket exists (`packages/core/src/decisions/service.ts:171`), never its status, and nothing re-checks
afterwards. A decision created *after* its ticket finished therefore has no future terminal transition
to ride. Measured: 12 decisions daemon-wide were created at or after their ticket's terminal
timestamp; 10 were later answered; 2 are still open today, both weaver follow-up `question`s on scout
tickets that had gone `done` 52 and 82 seconds earlier.

The trigger is the default. `weave_ask` defaults `ticketId` to `ctx.claims.ticketId`
(`packages/server/src/tools.ts:376`), so a weaver woken about a just-finished ticket and asking a
follow-up silently attaches the card to a finished ticket.

**Defect 2 — the weaver cannot tell a stale card from a fresh one.** The per-turn prompt lists open
decisions at `packages/core/src/prompts/index.ts:326-330`, capped at 8, oldest first, showing only
`id [kind, owner] title`. No age, no ticket status. A 23-hour-old card on a `done` ticket is
indistinguishable from one raised a minute ago.

## Decision 1 — at creation, a terminal ticket is dropped, not the decision

`create()` resolves the named ticket, and if its status is terminal (`done` or `cancelled`) it
creates the decision with **no ticket attachment** (`ticketId = null`) and logs a warning naming the
ticket and the decision kind. The decision is otherwise untouched — same kind, owner, options, inputs
and answer path — and keeps both the terminal ticket's **project** and the correlation-key bucket it
would have had, both resolved from the original ticket before the attachment is dropped (see below).

Why not refuse. The ticket explicitly warns that refusing "may break a legitimate 'the ticket
finished, here is what I learned' ask, which is exactly what these two were." The two orphaned cards
were real, answerable follow-ups; a rule that makes them impossible trades a leak for a lost
capability. Refusal is the wrong tool.

Why not warn and still attach. Warning alone fixes nothing: the card is still scoped to a ticket that
cannot close it, so it is still orphaned until the 24-hour sweep reaches it. It would leave a
day-long window in which every direct reader of `decisions` (the weaver's prompt, the briefing, the
UI) sees a live-looking card on a dead ticket — the exact confusion defect 2 exists to reduce.

Why detach. A decision is scoped to a ticket because it decides something about *that ticket's live
progress*; a gate or a question about a ticket that has already finished decides nothing about its
progress. Dropping the attachment states that honestly, and makes the decision structurally
incapable of being stranded by a transition that will never arrive: there is no ticket left to
transition. The project survives, the asker still gets woken with the answer, and the human still
sees the card — it simply stops pretending to be a gate on a finished ticket. The weaver is expected
to name the finished ticket in the title or context if the reference matters, which the two real
cases already did ("here is what I learned from VOFM-33").

**Why the correlation key is preserved too, not recomputed from the empty attachment.** `create()`
defaults the key to `${kind}:${ticketId ?? 'workspace'}`, and `supersedeOpen()` matches on
`ticket_id IS ? AND correlation_key = ?`. If the key were recomputed after the ticket was dropped, a
detached follow-up would fall into the shared `question:workspace` bucket. That bucket is real and
busy (19 rows in fern-services, 6 in fern-ofm, all serially superseded — the proof it actively supersedes):
the detached card would either kill an unrelated open workspace-level question, or be killed by the
next one asked. Silently closing a human's open card is the exact failure this ticket exists to stop,
so the guard computes the correlation key from the **original** ticket id, exactly as it preserves
the project. The detached decision then occupies its own per-ticket bucket (`question:<ticketId>`)
and neither supersedes nor is superseded by any workspace-level decision of the same kind. This is
asserted by a test (task 1.2): a detached follow-up does not supersede an open `question:workspace`
card, and a subsequent workspace-level question does not supersede it.

The guard reads the ticket status and then inserts in a separate step, so a ticket that transitions
to terminal in between can still race the insert. That race is one reason the sweep below is kept
even though creation now handles the common case — see Decision 2.

## Decision 2 — a 24-hour grace period, and why a backstop is still needed

The sweep withdraws an `open` decision attached to a ticket that is already terminal **and** whose
`created_at` is older than a grace period. It reuses `withdrawOpenForTicket` (extended with an
optional created-before filter), so a swept decision is recorded exactly like one withdrawn by a
terminal transition: status `withdrawn`, the reason in `answerText`, a `decision.withdraw` activity
row, and a `decision.answered` event.

**Threshold: 24 hours**, matching VS-305's suggestion and the briefing's landed-window scale. The
observed near-misses were 52 and 82 seconds after terminal; the point of the threshold is to give a
human at least one normal review cycle — including an overnight gap — to see and answer a follow-up
raised just after a ticket finished. A shorter window risks destroying the legitimate ask the
creation guard deliberately preserves; a longer one leaves a genuinely dead card visible for days.
24 hours is the smallest round period that guarantees a card created late in the day is still waiting
the next morning.

**Why the sweep survives the creation guard.** The guard stops the common path, but three things
still need a backstop. (1) Rows already exist — the 2 open cards and the 10 historical ones — and no
new guard can retroactively fix them; the ticket requires the two open cards be closed by the
mechanism. (2) The status read and the insert in `create()` are not one atomic step with the ticket's
transition, so a ticket can finish between them and leave an attached decision. (3) `propagateTerminal`
already wraps its withdrawal in a `try/catch` that only logs, so a failed withdrawal on a live
transition leaves an attached `open` decision behind. The sweep is the one place that reconciles all
three.

**Why not `expireDue`.** Expiry is not a quiet tidy-up: `expireDue` transitions the ticket to
`blocked` (`decisions/service.ts:607-614`). A terminal ticket must not be moved to `blocked` by
housekeeping, so the sweep is a separate pass that reuses the withdrawal path.

## Decision 3 — the gate rule, and why the sweep and the repair scan cannot contend

`plan_approval`, `merge_approval` and `action_approval` are gates on whether work proceeds, and
nothing in this change may auto-close one while its ticket is live. The sweep's only predicate on the
ticket is `status IN ('done','cancelled')`; a ticket that is terminal is by definition not waiting on
a gate, so the sweep can run across every decision kind without touching a live one.

The approval-integrity repair scan (`supervisor/index.ts` → `tickets.repairApprovals()`) re-raises a
stranded approval only for a `change` ticket in `proposed`, a ticket in `in_review` without
`auto_merge`, or an `operational` ticket not in a terminal status
(`packages/core/src/tickets/service.ts:1246-1314`). None of those statuses is terminal, and
`repairApprovals` never targets a `done` or `cancelled` ticket. Since the sweep only touches terminal
tickets, the two sets are disjoint and neither can undo the other. This is asserted by a test, not
just argued.

## Decision 4 — the weaver's open-decisions line

The query joins `tickets` so each line can carry the ticket's identifier and status, and formats the
decision's age with `formatAge` from `@weave-ai/render` (`core` already depends on `render`), the same
short form (`4m`, `23h`, `6d`) used on ticket cards:

```
- <id> [question, owner human, VOFM-33 done, 23h] <title>
```

A decision with no ticket shows no ticket segment (`[question, owner human, 23h]`). Age and ticket
status are the whole change: it costs nothing, risks nothing, and is what lets a weaver actually
notice a card that outlived its ticket. The cap of 8 and the oldest-first order are unchanged.

## Noted, not fixed

`briefing/service.ts:24-29` orders `needsYou` newest-first with a limit of 20, so the *stalest*
cards are the first to fall off the weaver's own briefing — the opposite of what a "needs you" list
should do. That is a separate defect with its own UI/ordering trade-offs and is not part of this
change; it is worth its own ticket (recommended in the report).

## Effect on the two known open cards

They are attached to terminal tickets and predate this change, so the creation guard does not apply
to them. The sweep does: once they are older than 24 hours they are withdrawn by the same auditable
path, with no hand edit.
