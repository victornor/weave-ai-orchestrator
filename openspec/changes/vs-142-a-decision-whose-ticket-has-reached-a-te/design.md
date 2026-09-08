## Investigation

**No existing code closes a decision because its ticket finished.** Grepping the decisions service
for `supersede|expire|closed|obsolete` finds only:
- `supersedeOpen()` / `supersedeForTarget()` (`packages/core/src/decisions/service.ts:76-87,452-454`)
  — closes an open decision only when a *newer* decision with the same `correlationKey` is about to
  replace it (`create()` always calls it first). Nothing here reacts to a ticket's status.
- `expireDue()` (`service.ts:456-481`) — time-based only (`expires_at <= now`), and its own side
  effect *blocks* the ticket and wakes the conductor, which is the opposite of what a decision on an
  already-terminal ticket needs.

**`propagateTerminal()` is the one place all three terminal-reaching paths already converge.**
`packages/core/src/tickets/service.ts:207-229`, called from:
- `transition()` at line 405: `if (TERMINAL.has(to)) propagateTerminal(next, actor);` — this is also
  the exact path VS-71 took, since `merging → done` is a valid direct transition in `CHANGE`'s state
  machine (`packages/shared/src/transitions.ts:12`), and the conductor used it once the PR was
  already merged out-of-band and `mergeDone()`'s own landing/verification could not run against it.
- `cancel()` at line 638, inside its own transaction.
- `mergeDone()` at line 809, outside its transaction (which has already committed by then).

`tx()` (`packages/core/src/tickets/tx.ts`) is nesting-safe (depth-tracked, only the outermost call
opens a real `db.transaction`), so a new decisions-service call from inside `propagateTerminal` is
safe regardless of which of the three callers reached it, and regardless of whether that caller is
itself already inside a transaction.

## Which decision kinds close, and why

Checked every real (non-test) call to `decisions.create()` for whether `ticketId` is a real ticket id
or omitted/`null`:

| kind | ticketId at creation | closes on terminal ticket? |
|---|---|---|
| `plan_approval` | always `t.id` (`tickets/service.ts:349`) | yes |
| `merge_approval` | always `t.id` (`tickets/service.ts:374`) | yes |
| `retry_approval` | `f.agent.ticketId ?? null` (`runs/engine.ts:597-620`, `parkForHuman`) | yes, when set |
| `gate_finding` | ticket-scoped at two sites (`engine.ts:520-525`; `authgate.ts:142-148`), explicitly `null` at a third (`authgate.ts:120-127`, a runtime-wide login outage, "Not attached to a ticket") | yes, when set; the runtime-wide one is never set, so untouched |
| `question` | `null` for the one core-raised case (`models/index.ts:82-93`, the workers-runtime migration — workspace-wide); real or `null` via `ac_ask` (`server/src/tools.ts:326-344`) depending on whether the caller is asking about a specific ticket | yes, only when scoped to a ticket |
| `concern` | only raised via `ac_ask`, same as `question` above | yes, only when scoped to a ticket |
| `hire_approval` | never set (`roles/index.ts:121-132` — scoped to a role, not a ticket) | no, never applicable |
| `discard_approval` | never set (`roles/index.ts:262-270` — scoped to a role) | no, never applicable |

The rule needs no kind allowlist: **filtering by `ticket_id = <the finished ticket's id> AND status =
'open'` already selects exactly the decisions that should close.** Every kind that is ever scoped to
a ticket is scoped to *that ticket's own progress* and has nothing left to decide once it is done or
cancelled; every kind that legitimately outlives a ticket was never scoped to one in the first place.
This is also why the requirement is written as one rule over `ticketId`, not a switch over `kind`.

## Why `withdrawn`, not `superseded` or `expired`

The ticket's own phrasing ("superseded or expired, whichever the existing model fits") named the two
statuses visible in the bug report's context, but neither actually fits once the model is checked:

- **`superseded`** means a *newer* decision under the same `correlationKey` is replacing this one
  (`supersedeOpen`, only ever called from `create()` and `putDocument`'s plan-revision path). Nothing
  is replacing the closed decision here — the ticket just stopped needing an answer.
- **`expired`** is `expireDue()`'s status, and that function's side effect is to `transition()` the
  ticket to `blocked` and wake the conductor (`service.ts:472-478`). Reusing it here would try to
  block a ticket that just became `done`/`cancelled` — the wrong direction entirely.
- **`withdrawn`** already means exactly this: an open decision closed for an operational reason,
  without an answer. Every existing caller of `withdraw()` fits the same shape — the login was
  restored (`runs/authgate.ts:191`), the worker recovered (`runs/engine.ts:498`), the ticket moved
  again before the decision was answered (`runs/engine.ts:510`). "The ticket this decision was about
  reached `done`/`cancelled`" is one more entry in that same family, not a new concept.

So the fix adds a *bulk* form of the existing single-decision `withdraw()` — `withdrawForTicket(actor,
ticketId, reason)` — rather than inventing a new status. It reuses `withdraw()`'s exact write shape
(`status: 'withdrawn'`, `answerText: reason`) and its exact event (`decision.answered`), so the
live-visibility reconciliation VS-140 already built (client patches every cached decisions-list query
on `decision.answered`) removes the card from every view with no client-side change at all.

## Recorded and auditable (AC #3)

Each closed decision gets its own `decision.withdraw` activity row (`recordActivity`, same as a
manual `withdraw()`) carrying `{ reason }`, where `reason` names the ticket and the status it reached
(e.g. `"VS-71 reached done"`). Reading the activity log for that decision id shows exactly why it
stopped being open, distinct from a human's own withdrawal (whose reason is theirs) or an expiry
(logged as `decision.expired`).

## The "worth checking" question: a cleaner path to `done`

The ticket asks whether there is a cleaner way for the conductor to close a `change` ticket whose
merge verification cannot pass, without routing it through `merging` at all. There is not one worth
building here: the landing-branch mismatch that caused *this* instance (`edge` vs. `main`) is
`landingBranchOf()` (VS-119, shipped) and its per-project/per-ticket configuration (VS-141) — already
the real fix for "verification checks the wrong branch," and VS-141 is explicitly out of scope for
this ticket. Once that lands and is configured correctly, `mergeDone()`'s own verification passes and
the direct `merging → done` escape hatch is not needed for this cause anymore. Building a second,
parallel "skip the merge queue" path today would duplicate that fix rather than replace it, so this
change leaves the transition table alone and only makes sure that whichever path a ticket takes to
`done`/`cancelled`, its stale decisions do not linger.
