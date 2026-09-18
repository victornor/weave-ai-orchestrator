## Why

On 2026-09-17 two `change`-ticket workers, two minutes apart, finished their work, opened a PR, and
were refused `weave_ticket_transition(approved → in_review)`: a change ticket had to pass through
`in_progress` first. Both recovered, but both burned a call. The refusal already names the reachable
statuses (VS-209, `details.allowed`), and it did not help — the ordinary "this is ready to be looked
at" status is not reachable from the status the worker is actually in, so the interface disagrees
with the obvious mental model.

The investigation the ticket asked for shows nothing depends on the intermediate step for a change
ticket:

- Entering `in_progress` writes only `tickets.started_at`. That column is also written on
  `proposing` — which every change ticket already passes through — and is read nowhere in the repo.
- `approved` is already a liveness status (`LIVENESS_STATUSES`), so a worker sitting there is
  supervised exactly like one in `in_progress`.
- The board derives "In progress" from a live worker, not the stored status (`columnFor`), so no
  surface distinguishes the two.
- Entering `in_progress` has no decision, wake, lock or supervision side effect; the transition
  function's only per-status handler for it is the `started_at` stamp.

The same forced intermediate exists for every other kind — `task` cannot reach `in_review` or `done`
from `todo`, `scout`/`question`/`operational` cannot reach `done` from `todo` — and has only gone
unnoticed because those workers have not tried the obvious call yet. The worker instructions already
describe the direct path (`approved` "ends with `in_progress` (implicit) or `in_review` when all
tasks are done"; scout is `todo → in_progress → done`), so the code is what disagrees.

## What Changes

- Every kind may move directly from the status where its work begins to the status where it is
  delivered or finished:
  - `change`: `approved → in_review` (a work product is still required, as today)
  - `task`: `todo → in_review` (a diff to land) or `todo → done` (nothing to land, ending stated)
  - `scout` / `question` / `operational`: `todo → done`
- `in_progress` stays on the graph and stays reachable from every start status. It becomes an
  optional marker for work that spans turns, never a precondition of delivery.
- Every existing gate is unchanged: `in_review` requires a work product; `task → done` requires a
  stated ending and refuses unlanded commits; `operational → done` refuses unlanded commits; the
  operational `action_approval` gate still fires on the `action` document write regardless of the
  ticket's status.
- `started_at` is stamped on the first transition into any working or delivery status
  (`proposing`, `in_progress`, `in_review`, `merging`, `done`), so a direct delivery does not leave
  it null.
- Worker-facing instructions (worker, scout and openspec skills, and the rendered brief) stop
  presenting `in_progress` as the mandatory post-approval step and state that a worker may go
  straight to `in_review` / `done` when the work is finished.
- `docs/PLAN.md` §6.2 / §12.2 / §12.3 are updated to the new contract, with a new ADR recording why
  the forced intermediate step went.

## Capabilities

### New Capabilities

- `ticket-lifecycle/direct-delivery`: a ticket may be transitioned straight from the status where
  its work begins to the status where it is delivered or finished; `in_progress` is optional and is
  never a precondition of delivery.

### Modified Capabilities

- `ticket-lifecycle/transition-errors`: the canonical graph-rejected example is no longer
  `change approved → in_review` (now legal); the requirement keeps its meaning with a still-invalid
  example.
- `ticket-lifecycle/task-completion`: a task may finish from `todo`, not only from `in_progress`.
- `ticket-lifecycle/operational`: an operational ticket may finish at `done` from `todo`; the
  action-approval gate is unchanged.

## Impact

- `packages/shared/src/transitions.ts` — direct edges in the `change`, `task` and `scout` (used by
  scout/question/operational) maps.
- `packages/core/src/tickets/service.ts` — `started_at` stamping on the delivery statuses.
- `packages/core/src/tickets/tickets.test.ts` — behavior pinned per kind; the VS-209 test that
  asserts `approved → in_review` is rejected is rewritten.
- `skills/weave-ai-worker/SKILL.md`, `skills/weave-ai-scout/SKILL.md`,
  `skills/weave-ai-openspec/SKILL.md`, `templates/worker.AGENTS.md.tmpl` — instructions.
- `docs/PLAN.md` and a new `docs/adr/` record — the contract and its rationale.
- No API or MCP schema change: the transition table is internal, and `weave_ticket_transition`'s
  input and output shapes are untouched.
