## Context

See proposal.md - Why. The transition graph already exists as a plain data table, `TRANSITIONS: Record<TicketKind, Record<TicketStatus, readonly TicketStatus[]>>` in `packages/shared/src/transitions.ts`, queried by `canTransition(kind, from, to)`. The rejection is thrown by `checkTransition` in `packages/core/src/tickets/guards.ts`, which has both `kind` and `from` in scope at the point it throws.

## Goals / Non-Goals

**Goals:**
- Attach the reachable-status list to the one `invalid_disposition` throw that is a graph lookup, using data the service already has in scope.

**Non-Goals:**
- Adding an `allowed` (or similar) field to the other two `invalid_disposition` throws in `checkTransition` (same-status no-op; `in_review` without a work product) or to `missing_action_path` / `merge_not_approved`. Those are stateful guards where "allowed" isn't a fixed list — out of scope per the ticket.
- Adding a general-purpose `nextStatuses(kind, from)` export. `TRANSITIONS[kind][from]` is already directly queryable and exported; wrapping it would be an unrequested abstraction for a single call site.
- Any UI change. This is a `details` field on an error object consumed by tool callers (workers, the CLI), not a new user-facing surface.

## Decisions

- **Compute `allowed` inline at the throw site in `guards.ts`** as `TRANSITIONS[kind][from]`, rather than introducing a helper function. There is exactly one call site; a wrapper would be indirection with no second caller to justify it. `TRANSITIONS` is already imported transitively via `canTransition`, so the guard file imports `TRANSITIONS` alongside `canTransition` from `@agent-conductor/shared`.
- **Field name `allowed`** on `details`, alongside the existing `kind`, `from`, `to`. Chosen over `nextStatuses` or `validTransitions` for brevity and because it reads naturally next to `from`/`to` in the same object.
- **No schema/type change to `OcError`.** `details` is already `Record<string, unknown>` and already serializes whole via `toJSON()` / `ToolResult.fail()`. No route or MCP wrapper needs to change to pass the new field through.

## Risks / Trade-offs

- [`TRANSITIONS[kind][from]` could theoretically be `undefined` for a malformed `(kind, from)` pair] → Not a new risk: `canTransition` already indexes the same table the same way one line earlier in the same function and would have already returned `false`/thrown before reaching the new code, so if we get to the `invalid_disposition` throw, `TRANSITIONS[kind][from]` is guaranteed to already be a valid (possibly empty) array.

## Migration Plan

None — additive field on an existing error, no data migration, no API version bump. Deploys with the next release like any other code change.
