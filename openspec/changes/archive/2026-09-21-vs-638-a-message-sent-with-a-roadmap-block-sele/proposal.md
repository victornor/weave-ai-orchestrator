## Why

Captain sent an ask with roadmap block `UI polish #3` selected in the composer and the weaver filed
it as a ticket (VS-637) instead of adding it to the block; the selection existed only in the wake
payload, and the wake text the weaver read named the project but not the block. A rule that depends
on the weaver opening a payload it has no reason to open is not a control. The human's structured
choice has to be visible in the text the weaver actually reads, and filing a ticket in that turn has
to be refused rather than silently done.

## What Changes

- Render a human message's selected roadmap block and project in plain words in the turn prompt's
  "What was said" section and on the message's entry in `weave_inbox`, so the selection is impossible
  to miss without reading the structured payload. A message with a project but no block renders as it
  does today.
- Guard `weave_ticket_create`: when the current turn was woken by a human message that carried a
  `blockId`, the call is refused unless it passes an explicit `blockOverride: "<reason>"`. The error
  names the block and points at `weave_roadmap_item_add` (or `weave_roadmap_block_start` when the
  human asked to start the block).
- An overridden call proceeds and records the reason as an activity entry against the created ticket.
- Scope the guard to the turn triggered by that message. A later wake, a worker turn, a routine turn,
  a message without a block and a human caller are unaffected; `weave_roadmap_item_add`, comments and
  every other tool are never blocked.
- State the rule once in the `weave-ai-weaver` skill, in two lines: a block the human selected means
  the ask is a roadmap item, not a ticket.

## Capabilities

### New Capabilities
- `roadmap/selected-block-guard`: showing a message's selected roadmap block in the wake text and
  refusing to file it as a ticket in that turn unless an explicit override reason is given.

### Modified Capabilities
- `agent-prompts/roadmap-intake`: the weaver's `weave-ai-weaver` skill states that a selected roadmap
  block means the ask is a roadmap item; contradictory duplicated prose is removed.

## Impact

- `packages/core/src/prompts/index.ts` — turn-prompt rendering of a human message's selection, and a
  shared renderer exported for the inbox.
- `packages/server/src/tools.ts` — `weave_inbox` message entry and the `weave_ticket_create` guard
  and override activity record.
- `skills/weave-ai-weaver/SKILL.md` — the selected-block rule, stated once.
- Tests: `packages/core/src/prompts/render.test.ts` (wake text and skill assertion) and
  `packages/server/test` (guard, override activity, scoping). No schema change.
