## Context

`autoMergeSweep()` (`packages/core/src/tickets/service.ts:1526`) selects every `in_review` ticket in
the workspace with `autoMerge` or YOLO, and for each one either advances it, or — when it cannot —
posts a system comment:

- `archive-before-merge`-style CI wait: `systemComment(t.id, 'auto-merge is waiting: CI is red on the
  PR', …)` (`:1545` before this change);
- VS-266's weaver concern: `revision_pending` from the merge approval, `'auto-merge is waiting: the
  weaver has concerns'` (`:1559`).

The sweep is invoked from the supervisor loop on every tick (`supervisor/index.ts:1142`), and
`tickets/service.ts:727` schedules one 50 ms after any ticket enters `in_review`. Both comment sites
sat *inside* the loop body, so a ticket that stayed held collected one comment per pass.

**Real bytes.** `SELECT body, created_at FROM ticket_comments WHERE ticket_id = …` for VS-457 and
VS-467 after YOLO was enabled for this project at 2026-09-15 02:58:58Z shows 18 identical
`auto-merge is waiting: …` comments on each ticket, 02:59:08Z → 03:02:53Z — a 15-second cadence.

## Goals / Non-Goals

**Goals:** one waiting comment per `(reason, pull request head)` per ticket, surviving a daemon
restart; a new head or a changed reason comments once more; an advance clears the record so a later
identical hold comments afresh; every other behaviour of the sweep unchanged.

**Non-Goals:** changing when the sweep runs, how it decides to advance, the CI-red wait, the
`revision_pending` hold, or deleting existing comments. No new table, route or migration.

## Decisions

### Decision 1: The hold is `{ reason, head }` recorded in `tickets.delivery_json`

`delivery` is already the ticket's durable, freely-extended JSON blob (`Record<string, unknown>`),
read back by the archive-backfill machinery (`openspecArchive`, VS-389) with the same merge-not-replace
pattern. A new key `autoMergeHold` is invisible to every existing reader. No migration, no new column.

The reason stored is the comment body verbatim, so the posted text is byte-identical to what the
sweep posted before; the head is the pull request head SHA.

### Decision 2: The head comes from the pass's own `prState`, falling back to the delivery head

In the CI branch the sweep already calls `forge.prState(...)`; that call's `headSha` is captured and
used for the hold. For the concerns branch, which does not otherwise need the forge, the head is
`resolveDeliveryHead(t)` (VS-365: the pull request's head, else the worktree HEAD, else the project
branch ref). The fallback keeps the check to a single forge call in the common (CI) path, and a
`prState` that omits `headSha` degrades to a reason-only key rather than failing.

### Decision 3: An advance clears the hold, and that is the "advanced and returned" case

`clearAutoMergeHold` deletes the key after the ticket successfully moves to `merging`. The ticket
description asks for a comment "back after the ticket advanced and returned"; clearing on advance is
what makes that fall out — the state is absent, so the next hold is new whatever its reason or head.
Clearing rather than keeping a timestamp also means the state cannot grow stale across restarts.

### Decision 4: `recordArchiveLandingFailure` is already deduped; nothing else in the file needs it

That path (VS-389, `:330`) compares the reason and pull request against `delivery.openspecArchive.lastFailure`
and only comments/wakes on a change. `raiseArchiveBackfillCard` raises a decision, not a comment, and
its `autoApprove` throws propagate to the supervisor, which does not comment per pass. So within this
file the two `autoMergeSweep` sites were the only every-pass comments.

## Risks / Trade-offs

- **A genuinely ambiguous head (forge reports none, no worktree).** → the key degrades to
  `(reason, null)`, so only a reason change re-comments. Acceptable: the alternative is re-commenting
  every pass, the bug being fixed.
- **`delivery` is also written by other paths (open PR, merge, archive backfill).** → all of them
  spread the existing object (`{ ...(t.delivery ?? {}), … }`), so `autoMergeHold` survives them.
- **A ticket held for CI red whose head advances every pass.** → each head comments once; that is the
  specified behavior (a new push is new information worth one comment).