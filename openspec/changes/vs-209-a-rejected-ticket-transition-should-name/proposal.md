## Why

`ac_ticket_transition` rejects an illegal move (e.g. `approved → in_review` on a `change` ticket) with an `invalid_disposition` error that names only what was tried, not what would have worked. The valid graph is a static table the service already holds (`packages/shared/src/transitions.ts`); the rejection just doesn't surface it. Workers have documented this exact trap in the project knowledge base and still trip it, paying a wasted call each time — prose guidance is not fixing an interface that disagrees with the obvious mental model.

## What Changes

- When `checkTransition` rejects a transition because it is not in the ticket kind's reachability graph (the `canTransition` check in `packages/core/src/tickets/guards.ts`), the thrown `OcError`'s `details` gains an `allowed` field: the array of statuses actually reachable from the current status for that ticket kind, i.e. `TRANSITIONS[kind][from]` from `packages/shared/src/transitions.ts`.
- This applies only to the graph-reachability rejection (the one carrying `kind`, `from`, `to` today). The other two `invalid_disposition` throws in the same function — same-status no-op, and `in_review` without a work product — are stateful guards, not graph lookups, and are out of scope: there is no fixed "allowed next status" list to attach to them.
- No behavior of the state machine itself changes: the same transitions are legal or illegal as before. This is strictly additive information on an existing error.
- Worker-facing guidance already documents the `approved → in_progress → in_review` path (`skills/agent-conductor-worker/SKILL.md`'s status table and its "Common mistakes" row, and `skills/agent-conductor-openspec/SKILL.md`'s mapping table) but never names the error code or shows what the error itself now returns. Add one line to `agent-conductor-worker`'s "Common mistakes" table pointing at the new `details.allowed` field, so a worker hitting the rejection live learns to read the error instead of needing to have memorized the graph.

## Capabilities

### New Capabilities
- `ticket-lifecycle/transition-errors`: a rejected ticket-status transition names which statuses are actually reachable from the current one, for the ticket's kind.

### Modified Capabilities
(none — no existing capability spec currently describes ticket transition error behavior)

## Impact

- `packages/core/src/tickets/guards.ts` — the `invalid_disposition` throw for graph-invalid transitions gains an `allowed` field in `details`.
- `packages/core/src/tickets/tickets.test.ts` — new test asserting `details.allowed` for the `approved → in_review` change-ticket case.
- `skills/agent-conductor-worker/SKILL.md` — one line added to the "Common mistakes" table.
- No API/MCP schema change: `details` is already an open `Record<string, unknown>` on `OcError`, so no consumer that reads `code`/`message` is affected. Any caller inspecting `details` (server routes, MCP tool wrapper) passes it through unchanged since it already serializes the whole object.
