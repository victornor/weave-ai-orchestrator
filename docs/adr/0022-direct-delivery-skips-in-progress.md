# ADR 0022 — A ticket delivers from where its work begins; `in_progress` is optional

**Status:** accepted · 2026-09-18 · rewrites the `in_progress` step in the planned flows
(PLAN §6.2 / §12.2 / §12.3), and the `in_progress`-specific details of ADR 0016 and ADR 0017

## Context

On 2026-09-17 two `change`-ticket workers, two minutes apart, finished their work, opened a PR, and
were refused `approved → in_review`: the graph required `approved → in_progress → in_review`. Both
recovered, but both burned a call, and the refusal already named the reachable statuses (VS-209) —
so the message was not the missing part. The worker instructions say the opposite of the graph: the
worker skill's status table says the `approved` phase "ends with `in_progress` (implicit) or
`in_review` when all tasks are done".

VS-541 asked what the intermediate step was actually for. The audit found nothing:

- Entering `in_progress` writes only `tickets.started_at`. Every `change` ticket already writes it at
  `proposing`, and no code reads a ticket's `started_at` (the `startedAt` reads in `packages/ui` and
  `packages/render` are run/job/upgrade fields).
- `LIVENESS_STATUSES` includes `approved` as well as `in_progress`, so a worker parked in `approved`
  is repaired by `livenessScan` exactly as one in `in_progress` would be. The status adds no
  supervision.
- `columnFor()` derives the board's "In progress" column from a live worker, not the stored status,
  so no surface reads the difference.
- `transition()` has no `to === 'in_progress'` branch: entering it raises no decision, queues no
  wake, takes no lock and opens no supervision window.

The same required step existed in every other map: `TASK.todo` could not reach `in_review` or
`done`, and the scout map's `todo` (scout, question, operational) could not reach `done`. `question`
was the plainest contradiction: PLAN §12.3 documents `todo → done`, the code refused it.

## Decision

A ticket may move straight from the status where its work begins to the status where it is delivered
or finished, for every kind. `in_progress` stays on the graph and stays reachable from every start
status, but it is an optional marker for work that spans turns, never a precondition of delivery.

| Kind | Start | Direct delivery |
|---|---|---|
| `change` | `approved` | `in_review` |
| `task` | `todo` | `in_review` (a diff) or `done` (nothing to land, ending stated) |
| `scout` / `question` / `operational` | `todo` | `done` |

Every stateful gate is unchanged: `in_review` still requires a work product; `task → done` still
requires a stated ending and refuses unlanded commits; `operational → done` still refuses unlanded
commits; the operational `action_approval` still fires on the `action` document write, and an
operational ticket that takes an action still proposes it from `in_progress` as
`ticket-lifecycle/operational` requires.

The one observable effect of the removed step is preserved: `started_at` is stamped on the first
transition into any working or delivery status (`proposing`, `in_progress`, `in_review`, `merging`,
`done`), so a direct delivery records it. `approved` is deliberately not included — it means
permission, not work.

## Consequences

- A worker that finishes in one turn never performs a status transition with no behavior behind it;
  the two 2026-09-17 incidents cannot recur for any kind.
- `in_progress` becomes a status a worker chooses to signal multi-turn work, not one the daemon
  insists on. Nothing that read it loses information, because nothing read it.
- The operational action gate is untouched: it is the document write that raises the approval, and
  the status is not what makes the wait safe.
- Where ADR 0016 said a no-diff task finishes "straight from `in_progress`", and ADR 0017 said an
  operational ticket moves `todo → in_progress → done`, read those as superseded by this record.
