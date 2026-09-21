## Context

An inbound human message on a conductor thread already carries its composer selection into the wake
payload: `blockId` and `blockTitle` alongside `projectId` and `projectSlug`
(`conductor-chat/message-project-context`). What was missing is that the *rendered* turn text
(`buildTurnPrompt`'s "What was said" section and the `weave_inbox` message entry) named only the
project, so a weaver acting from the text alone never saw the block. See `proposal.md` — Why.

The turn prompt is built in `packages/core/src/prompts/index.ts` from `flattenWakes(wakes)`; the
`weave_inbox` tool lives in `packages/server/src/tools.ts` and reads the same wakes through
`bundledWakes(ctx)` / `flattenWakes`. Both already have the payload in hand.

## Goals / Non-Goals

**Goals:**
- The selected block is visible in the text the weaver reads, in both render surfaces, from one
  shared wording so the two cannot drift.
- Filing a ticket in the turn woken by that message is refused with an actionable message, and the
  only way past it is an explicit, recorded reason.
- The guard changes nothing for any other turn, tool or caller.

**Non-Goals:**
- Changing how the composer sends or stores the selection (already done).
- Blocking `weave_roadmap_item_add`, comments, or any tool other than `weave_ticket_create`.
- Any schema change; the override rides the existing append-only `activity` record.

## Decisions

**One renderer, both surfaces.** Add a pure `humanSelectionNotice(payload)` to
`packages/core/src/prompts/index.ts`, exported from `@weave-ai/core`, returning the plain-words
instruction only when `blockTitle` is a non-empty string, else `null`. `buildTurnPrompt` renders it
under the message heading; the `weave_inbox` handler attaches it as `selection` on the human_message
entry. A single function means the wording the ticket specifies appears once.
*Alternative:* render the notice inside the wake `reason` at enqueue time in `threads/service.ts`.
Rejected — the reason is a durable, workspace-visible string and it is already correct without the
instruction; the full instruction belongs to the agent-facing text, and keeping `reason` unchanged
avoids churning every reason assertion.

**Guard from the turn's own wakes, not persisted state.** The guard scans
`flattenWakes(bundledWakes(ctx))` for a `human_message` whose payload has a non-empty `blockId`. A
dispatched run carries its `wakeupIds`, so this is exactly the wake that triggered the turn; a later
wake, a worker turn, a routine turn and a human caller see nothing to guard. No new column, no
stateful "current selection" to clear.
*Alternative:* persist the selected block on the run and read it back. Rejected — more state for the
same scoping, and it would risk leaking into a later turn.

**Refusal is `validation`, and overridable.** The guard throws an `OcError('validation', …)` (with
`blockId`/`blockTitle` in `details`) naming the block and both roadmap tools. `validation` says
"this call is missing a required argument" — the fix is to pass `blockOverride` or use the roadmap
tool — where `forbidden` would read as "never allowed" for a call that has a legitimate escape.
A non-empty `blockOverride` lets the create run and records
`recordActivity(..., 'ticket.create_block_override', 'ticket', created.id, { blockId, blockTitle, reason }, created.id)`.

**Human callers are exempt.** The guard checks `ctx.actor.kind !== 'human'`, matching the ticket's
"weaver and agent tokens, not humans". Tool calls carry agent claims in production; the explicit
check keeps the contract honest and testable.

## Risks / Trade-offs

- **`bundledWakes` falls back to all queued wakes when a run's `wakeupIds` is unreadable.** A
  stale block-selected wake could then be seen by a later turn. → In production a dispatched run
  always records its `wakeupIds`; the fallback only fires for a hand-built test context, and the
  scoping tests exercise the normal path. The override escape keeps even that case unblockable.
- **The instruction repeats if several block-selected messages bundle into one turn.** → Acceptable:
  each repeat is attached to its own message, and the information is per-message.
- **A weaver that habitually passes `blockOverride`** defeats the guard. → The refusal is explicit
  and the override is recorded on the ticket, so the habit is visible where the ticket is read; the
  intent is to make the mistake impossible to make silently, not to forbid a legitimate case.

## Migration Plan

None. No schema or stored-data change; the extra activity action is append-only and needs no
backfill. Rollback is reverting the commit.

## Open Questions

None.
