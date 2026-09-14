## Context

See `proposal.md` — Why. This section only adds what is needed to justify the design.

**Where a block is resolved, and what does not happen.** A ticket transitions to `blocked` with an
`{owner, action}` path in `tickets.transition` (`packages/core/src/tickets/service.ts`). The three
paths that leave `blocked` automatically are all keyed to something other than a resolved action:
`blockedBy` tickets finishing (`propagateTerminal`, `setBlockers`), a quota-paused worker being
resumed (`workers.resume`), and a human retry (`tickets.retry`, `decisions.applyRetryApproval`).
A block that is resolved by an answer, a message or a comment takes none of those paths: those
services wake the worker and stop.

**Why the trigger belongs at turn start, keyed to the wake.** Each resolving service would need its
own restore and its own guess about whether the block was actually resolved. The run engine is the
one place that sees every turn and the wakes that started it, so a single check there covers every
resolving path — including ones added later. Keying it to the wake, rather than to the turn alone,
is what a rev 1 draft got wrong: `executeRun` runs for every wake, and `system`, `self_scheduled`
and system-booked `retry` wakes would have reopened (and a worker would then re-block) a ticket
whose owner had not acted at all, churning the board and — for a `weaver` owner — waking the weaver
on every tick of a worker's periodic self-check. Repeating wakes make "one turn, never a cycle"
false.

## Goals / Non-Goals

**Goals:**

- A ticket that is `blocked` when a resolving wake starts its worker's turn does not remain
  `blocked`, unless a `blockedBy` ticket is still unfinished.
- Restore the exact status the ticket held before the block, through the normal transition path, so
  events, activity, the board and the weaver see it — without disturbing the status's own pending
  card or queueing a second turn.
- A non-resolving wake (a timer, a self-check, a routine, a system retry) leaves the ticket blocked.
- Keep the re-block path honest: a still-stuck worker can block again, and that block stands until
  another resolving wake starts another turn.

**Non-Goals:**

- Changing when or why a ticket becomes `blocked`, or the parking/retry ladder.
- Changing the transition state machine (`packages/shared/src/transitions.ts`): `blocked` already
  reaches every status a ticket can be blocked from, for every kind.
- A weaver message delivered mid-turn into a running worker (no new wake, so no new turn): the
  restore happens on the worker's next turn. The original fern-ofm case is a decision answer that
  wakes the worker, which this covers.

## Decisions

**Trigger: a resolving wake on the run.** In `executeRun`, after the model resolves and the
pre-turn curation freshness gate has passed, before the run is marked running, the engine flattens
the run's claimed wakes (including anything coalesced into a bundle) and reopens a `blocked` ticket
only when at least one wake resolves the block. Resolving sources:

- `decision_answered` whose payload names this ticket (a decision answered on the ticket, or one with
  no ticket);
- `conductor_request` (the weaver's `weave_worker_message`);
- `human_message` and `live_interrupt` (the human reaching the worker);
- `ticket_comment` requested by a human;
- `system` marked `resumed` (`workers.resume`) or carrying a `relaunchNote` (`workers.relaunch`);
- `retry` requested by a human (the deferred retry answer to a usage-limit card).

Everything else — a generic `system` digest or liveness repair, `self_scheduled`, `routine`,
`ticket_assigned`, a system-booked `retry` from the ladder or the supervisor — leaves the ticket
blocked.

Alternatives considered:

1. *Reopen on any turn start* (the rev 1 draft). Rejected: a worker with a periodic self-check would
   reopen and re-block a ticket whose owner never acted, and a `weaver`-owned block would wake the
   weaver on every tick.
2. *Unblock in each resolving service* (`decisions.answer`, `workers.message`, `tickets.comment`).
   Rejected: three call sites, each guessing whether the block was really resolved, and still missing
   the paths added later.
3. *Unblock lazily when the worker performs unblocked-only work* — raising a plan or action
   approval, delivering a work product, reporting `working`. Rejected: many call sites, and a turn
   that is reading, investigating or fixing before it reports anything would leave the board lying
   for the whole turn — the exact symptom.
4. *Keep any-turn-start and make an identical re-block quiet.* Rejected: it leaves the churn in the
   status, activity and board (only the wake is quieted), and it is the more code for the worse
   outcome; (1) above is the cleaner model.

**Restore target: `blockedFromStatus`, through `tickets.transition`.** The column already exists
(VS-118) and is exactly "the status this ticket held before it was blocked". `retry()` and
`propagateTerminal()` already read it with the same fallback (`todo` when the ticket has an assignee
or worker, `backlog` otherwise). The one exclusion the ticket requires, an unfinished `blockedBy`,
is checked first — the same test `propagateTerminal` uses.

**The restore is quiet.** `transition` gains an internal `{ quiet?: true }` option, passed only by
`resumeIfBlocked`. It suppresses the two side effects that belong to *first* entering the target
status:

- the `in_review` `merge_approval` raise/supersede — the block was sitting in front of an open card
  the human may tap at any moment, and re-raising drops the weaver's `looked`/`concerns` review mark
  (VS-223); `repairApprovals` re-raises one if the ticket somehow reaches `in_review` without a
  card;
- the `approved` `ticket_assigned` wake — the worker is already starting this turn, and that wake
  would queue a second turn.

The `autoMergeSweep` scheduling for an auto-merge ticket, and the merge-queue join for a ticket
restored to `merging`, are left in place: they are what makes the restored status actually advance,
and neither disturbs the human.

**Never break the turn.** `resumeIfBlocked` wraps its transition in a guard and logs at warn on
failure — a ticket whose restore the state machine refuses must not stop the worker from working or
fail the run. The engine awaits it, so the status is written before the turn does anything visible.

## Risks / Trade-offs

- **The resolving-source list may miss a deliberate wake added later.** → The predicate is one small
  function with its own tests; adding a source is a one-line change and the failure mode is
  "blocked stays blocked", the current behavior, not a wrong unblock.
- **A ticket manually forced to `blocked` outside `transition()`/`setBlockers()`** has no recorded
  prior status and falls back to `todo`, exactly as the existing resume paths do. No such path
  exists today. → Accepted, consistent with VS-118.

## Migration Plan

No migration. `blockedFromStatus` and the transition table already exist. The change is daemon code
only and applies from the next resolving wake after an upgrade; a ticket already `blocked` when the
daemon restarts is restored on its worker's next resolving turn like any other.
