## Context

See `proposal.md` — Why. The transition graph is one plain data table,
`TRANSITIONS: Record<TicketKind, Record<TicketStatus, readonly TicketStatus[]>>` in
`packages/shared/src/transitions.ts`, and `checkTransition` in
`packages/core/src/tickets/guards.ts` enforces it before the service writes the status.

The ticket asked for an investigation before any change: what does the intermediate `in_progress`
step actually do for a `change` ticket? The findings, from reading the code:

- The only status-specific effect of entering `in_progress` is
  `if (!t.startedAt && (to === 'proposing' || to === 'in_progress')) patch.startedAt = now`
  (`service.ts`). Every `change` ticket already passes through `proposing` on its way to `approved`,
  so its `started_at` is already stamped; and nothing in the repo reads a ticket's `started_at`
  (the `startedAt` reads in `packages/ui` and `packages/render` are run/job/upgrade fields).
- `LIVENESS_STATUSES` includes `approved` and `in_progress` alike, so a worker waiting in
  `approved` is repaired by `livenessScan` exactly as one in `in_progress` would be. `in_progress`
  adds no supervision coverage.
- The board's `columnFor()` derives the "In progress" column from a live worker, not from the
  stored status, and `STATUS_COLUMN.approved` already folds into `in_progress`. No surface
  distinguishes the two.
- Entering `in_progress` raises no decision, queues no wake, takes no lock and starts no
  supervision window (`transition()` has no `to === 'in_progress'` branch).
- The same forced intermediate exists in the other maps: `TASK.todo` lacks `in_review` and `done`,
  and the scout map (used by scout, question and operational) lacks `done`. `question` is the
  sharpest case: `docs/PLAN.md` §12.3 documents `todo → done`, the code refuses it.

## Goals / Non-Goals

**Goals:**

- A worker that finishes in one turn can move straight from the status its work began in to the
  status that ends the work, for every kind.
- Keep every stateful gate exactly as it is (work product for `in_review`, stated ending and
  unlanded-commit refusal for `task → done`, unlanded-commit refusal for `operational → done`, the
  operational `action_approval` on the `action` document, merge approval on entering `in_review`).
- Record the reasoning and the one timestamp effect so the next reader does not have to redo it.

**Non-Goals:**

- No change to the statuses' meanings, to `blocked`/`cancelled`/reopen edges, or to the merge
  queue.
- No automatic status transition when a run starts: a worker still chooses its status; the change
  only stops the daemon from insisting on one that carries no information.
- No change to `weave_ticket_transition`'s input or output shape. The `details.allowed` field from
  VS-209 stays.
- No change to the operational `action_approval` gate. An operational ticket that takes an action is
  still expected to propose it from `in_progress`, exactly as `ticket-lifecycle/operational`
  requires; only the no-action finish may skip it.

## Decisions

### D1: Allow the direct edge on the graph, rather than only improving the refusal

The ticket offered two shapes: allow `approved → in_review`, or make the refusal self-correcting.
The direct edge is chosen because the investigation found nothing on the intermediate step to
depend on. A better error would still require a second call and a status change that means nothing,
which is the ceremony that produced the two 2026-09-17 incidents — and the worker instructions
already describe the direct ending ("`approved` … ends with … `in_review` when all tasks are done"),
so the code is the side that disagrees. `details.allowed` (VS-209) already tells a refused caller
what is reachable; it did not prevent either incident, which is evidence the message alone is not
the fix.

Alternative rejected: keep the graph, and make the invalid-transition error name the exact sequence
(`approved → in_progress → in_review`). Cheaper and no spec churn, but it institutionalizes a
required transition with no behavior attached.

### D2: Keep `in_progress` on the graph and reachable

Removing the status entirely is a larger contract change (the enum, the DB CHECK, the board, the
liveness rule) for no gain: a worker applying across several turns genuinely benefits from marking
"actively working", and `in_progress` remains the documented state for an operational ticket's
action-approval wait. It becomes optional instead of required.

### D3: Add the edge per map, not per kind-specific special case

`CHANGE.approved` gains `in_review`; `TASK.todo` gains `in_review` and `done`; the scout map's
`todo` (shared by `scout`, `question` and `operational`) gains `done`. This is the smallest edit
that makes the graph say what the worker contract says. No new helper and no per-kind branch in
`checkTransition`: the existing guards run on the destination status and are all that is needed.

### D4: Stamp `started_at` on the delivery statuses

The one observable effect of the removed step was the `started_at` stamp. To keep the column honest
for a ticket that never enters `in_progress`, the stamp condition expands from
`proposing | in_progress` to any status that means work has begun: `proposing`, `in_progress`,
`in_review`, `merging`, `done`. `approved` is deliberately not included — it means permission, not
work.

### D5: Update the docs and instructions in the same change

`docs/PLAN.md` §6.2 / §12.2 / §12.3 document the old route through `in_progress`; a new ADR records
the decision, and the worker/scout/openspec skills and the rendered brief stop teaching
`in_progress` as mandatory. The tests pin the new behavior per kind, including the operational case,
so the choice cannot drift back.

## Risks / Trade-offs

- [A worker could deliver without ever signalling "actively working", so the status is less
  informative] → No reader used it: the board uses the live worker, the liveness rule covers the
  start status, and nothing reads `started_at`. The status remains for those who want it.
- [Allowing `todo → done` on the scout map also allows it for `operational`] → Intended and covered
  by a spec change; the action gate is the document write, not the status, so no safety property is
  weakened. The operational spec already permits finishing at `done` without an action.
- [A worker could mistake the now-legal `task todo → in_review` for a way to skip the work product]
  → The `in_review` work-product guard is unchanged and pinned by a scenario.
- [Splitting behavior between `change` and other kinds is inconsistent] → The rule is uniform: from
  the status where work begins to the status where it ends, for every kind.

## Migration Plan

No data migration. The change is a code-level graph edit plus docs and tests; it deploys with the
next release like any other. A ticket already parked in a now-shortcut status transitions exactly as
before. Rollback is reverting the commit.

## Open Questions

None.
