## Context

See `proposal.md` — Why. Current writers of `tickets.delivery_json`:

- `addWorkProduct` (`packages/core/src/tickets/service.ts`) merges `{ prUrl, prState }` or `{ branch }` onto whatever is already there. It never sets `merged` or `mergeCommit`.
- Supervisor reconcile (`packages/core/src/supervisor/index.ts` `reconcilePullRequests`) refreshes `prState` from the forge for `in_review` tickets. When the forge says `merged` it tries `transition(merging)` then either wakes the worker to call `mergeDone` or calls `mergeDone` itself. The `prState` write happens *before* that, so a ticket that never reaches `mergeDone` keeps `{ prUrl, prState: "merged" }`.
- `mergeDone` is the only writer of `{ merged: true, mergeCommit, method, archivedAs, landed }` and of the `ticket.delivery_landed` activity row the changelog and VS-239's announcement read.

`transition()` allows `merging → done` for `change` and `task` (`packages/shared/src/transitions.ts`). That path records `ticket.transition` and sets `status: done` with no delivery enrichment. Combined with a prior `prState: "merged"` write, it is the VS-227 shape. `checkTransition` has no guard on this edge. `mergeDone` does not call `transition()`; it `touch`es `done` directly.

Surfaces today: `outcomeOf` (`packages/ui/src/components/TicketCard.tsx`) treats `merged: true` as `"merged"` (done tone) and otherwise any `prUrl` as `"PR ${prState}"` (accent). VS-227 therefore shows **"PR merged"** — close enough to a success that the board looks fine. Ticket detail (`TicketPage.tsx`) has no outcome chip and does not mention `delivery`. `conductor ticket show` prints status/kind/work products and never prints `delivery`. `conductor doctor` is host-tool checks (PLAN §20). `Ticket.delivery` is `Record<string, unknown> | null`.

## Goals / Non-Goals

**Goals:**

- One predicate, one implementation, every surface.
- Close `transition(merging → done)` so new rows cannot take that bypass.
- Historical incomplete rows become visible without being rewritten.

**Non-Goals:**

- VS-239's announcement and VS-232's landing verification (untouched).
- Repair/backfill of `mergeCommit` from the forge or git.
- A live nudge (conductor wake, decision card, reconcile sweep that pings anyone).
- `conductor doctor`.
- Changing the changelog source (`ticket.delivery_landed` stays the `landed` event).
- Adding a stored column; the predicate is derived from `status` + `delivery`.

## Decisions

### 1. Predicate: claimed merge without merge-done's signature

```
status === 'done'
AND (delivery.prState === 'merged' OR delivery.merged === true)
AND NOT (delivery.merged === true AND non-empty delivery.mergeCommit)
```

That is VS-227 (`prState: merged`, no `merged`, no SHA) and the weaker `merged: true` with a null SHA (merge-done ran without a recorded commit — `recordedSha ?? landInfo.head` both missing). Missing `landed` alone is **not** incomplete: merge-done still writes it as `landInfo?.detail ?? null` when the clone is absent, and the changelog row exists independently.

Scout / question / no-diff task / "reviewed without merging" (a PR URL whose state is not `merged`) fail the first conjunct and stay quiet.

`mergeCommit` is non-empty after trim; `null`, `""`, and a missing key are all incomplete.

**Alternative considered:** only `prState === 'merged' && !mergeCommit`. Rejected: it misses `merged: true` with no SHA, which is also a hole in the delivery record the announcement uses.

**Alternative considered:** also require `landed`. Rejected: false positives on a successful merge-done that skipped clone landing.

### 2. Pure helper in `packages/shared`, not a stored field

`incompleteDelivery(ticket: Pick<Ticket, 'status' | 'delivery'>): boolean` next to `landingBranchOf`. UI, CLI, and tests import it. No DB column, no API envelope field, no migration. `ac_ticket_get` still returns the raw `delivery` object; the CLI formatter and the UI chip are what make the gap visible to a human. Agents that inspect `delivery` can import the same helper; we do not add a parallel boolean on the wire that could drift from the JSON.

**Alternative considered:** persist `deliveryIncomplete` on the row. Rejected: it can stale if delivery is later patched, and it is derivable.

**Alternative considered:** wake the conductor once per such ticket (knowledge-health style). Rejected: VS-232 stopped the known producer; a standing wake about VS-227 (and any other historical row) is noise, and the ticket asked for visibility, not a live check.

**Alternative considered:** `conductor doctor`. Rejected: doctor is host setup (binaries, credentials), not ticket-data health.

### 3. Surfaces: reuse `OutcomeChip`; add it to ticket detail; print delivery on `ticket show`

- `outcomeOf` calls the helper first: incomplete → `{ label: 'delivery incomplete', tone: 'failed' }`. Complete `merged: true` stays `'merged'` / done. The VS-227 `'PR merged'` accent chip goes away for this shape.
- Ticket detail header (`TicketPage.tsx`, the row that already holds kind / interactive / folded-status badges) renders `OutcomeChip` for `done` / `cancelled`, same as the board card. No new banner chrome.
- `conductor ticket show` gains a `delivery` field: `incomplete — merged PR, no mergeCommit` (or the SHA when complete). Work-product table is unchanged.

TUI is not a separate surface for ticket outcome today (`ticketToSummary` has no outcome); leave render's summary shape alone unless CLI show needs a one-liner helper — prefer formatting in `commands/ticket.ts` from the shared predicate.

### 4. Guard: `merging → done` only via `mergeDone`

In `checkTransition`, when `from === 'merging' && to === 'done'`, throw `invalid_disposition` (same family as "in_review requires a work product") with a message that names `ac_ticket_merge_done`. Do **not** remove the edge from `TRANSITIONS`: the lifecycle still ends at `done`; the writer is `mergeDone`, which bypasses `transition()`. `details.allowed` is omitted (stateful guard, per `ticket-lifecycle/transition-errors`).

The state-machine test in `tickets.test.ts` ("matches the shared transition table exactly when every guard is satisfied") currently expects `merging → done` via `transition()` to succeed. Update that case: the edge stays graph-legal (`canTransition` true) and the call is rejected by the new guard. Assert the ticket remains `merging`.

`in_review → done` for a task that recorded an *open* PR stays legal (the "reviewed without merging" test). If reconcile has already set `prState: merged` on an `in_review` task, the predicate will mark it incomplete should it still reach `done` without `mergeDone`; this change does not add a second guard on that task-only edge — reconcile already tries to move those tickets to `merging`. Closing that leftover is a follow-up if it recurs.

Landing verification (`land.ts`, VS-232) is not touched.

## Risks / Trade-offs

- [A worker in `merging` that used to call `ac_ticket_transition(id, "done")` will be refused] → Intended. The worker skill already says to call `ac_ticket_merge_done`. The error names that tool.
- [A human `conductor ticket transition ID done` from `merging` will fail] → They use merge-done (or the merge queue finishes it). Marking done without landing was the bug.
- [Historical rows are never repaired, so VS-227 stays incomplete forever] → Acceptable: visibility is the ask; silently filling a SHA would invent a delivery record the announcement treats as truth.
- [Task `in_review → done` after reconcile wrote `prState: merged` can still produce the shape] → Predicate surfaces it; reconcile's next pass cannot move a `done` ticket. Follow-up only if it recurs; not in this change.
- [Board chip wording `'delivery incomplete'` is longer than `'merged'`] → Fits the existing 9rem Outcome column; failed tone is the signal.

## Migration Plan

None. Derived predicate, no schema change. Already-`done` incomplete tickets start showing the chip the moment the UI ships; no backfill job.

## Open Questions

None. The ticket's three product questions (where, which predicate, live vs passive) are decided above.
