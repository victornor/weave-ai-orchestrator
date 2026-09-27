## Why

`decisions.create()` defaults a decision's correlation key to `${kind}:${owner}:${ticketId ?? 'workspace'}` (VS-519). For a ticketless ask — the weaver's own `weave_ask` to the human, or a ticketless session's — every card of a given kind and owner falls into the one `workspace` bucket regardless of which project, or no project, it concerns. `create()` unconditionally supersedes whatever is already `open` under that key, so a second unrelated ticketless question silently replaces an older one with no notice to anyone. This happened on 2026-09-27: a weaver ticketless ask about Fernwood photo pricing superseded an 18h-old, still-unanswered ai-diary card, and captain was never told.

## What Changes

- The default correlation key for a ticketless ask (no ticket attached) of an askable kind (`question`, `concern`, `gate_finding` — the only kinds `weave_ask` can raise) is unique per call, not a shared `workspace` bucket, so two unrelated ticketless asks of the same kind and owner never collide by default.
- A caller that wants a ticketless re-ask to replace an earlier open one on purpose still can, by passing the same explicit `correlationKey` on both — that path is unchanged.
- Ticket-scoped dedup (same ticket + kind + owner supersedes, VS-519) is unchanged.
- This applies uniformly across every askable kind, not just `question`, and regardless of which agent kind raises the ask (weaver, worker, or a ticketless session).
- Every other decision kind (`retry_approval`, `hire_approval`, `merge_approval`, `plan_approval`, `action_approval`, `discard_approval`, `promotion_approval`) keeps deriving its default exactly as before — an audit of every `decisions.create()` call site (design.md) confirms each of those already passes its own explicit `correlationKey`, so this scoping changes nothing for them today and avoids silently changing their dedup semantics if a future ticketless call among them ever omitted a key.
- The `weave_ask` tool description states exactly when a new card supersedes an old one, so a caller can tell without reading the source.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `worker-escalation`: the correlation-key dedup this capability already specifies (VS-519's "Deduplication SHALL be preserved... on the same ticket") gets a companion requirement for the ticketless case, closing the gap where "no ticket" was treated as one shared bucket instead of no bucket at all.

## Impact

- `packages/core/src/decisions/service.ts` (`create()`): the default `correlationKey` expression.
- `packages/server/src/tools.ts` (`weave_ask` tool description): document the supersede rule.
- No schema change, no API shape change — `correlationKey` was already an optional passthrough field.
