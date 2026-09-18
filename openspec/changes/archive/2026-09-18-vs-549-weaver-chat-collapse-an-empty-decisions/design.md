## Context

See `proposal.md` — Why. The state that shapes the approach:

- **The V2 chat frame** is `packages/ui/src/v2/ChatPage.tsx`. It measures its own width with
  `useElementWidth` and splits when the region is at least `SPLIT_MIN_WIDTH` (620px) — `rail =
  canSplit`. The right `DecisionsPane` is an `<aside data-decisions-pane>` whose width is the
  draggable `divider` (300–560px, session-persisted through `writeDivider`). `openDecisions` and
  `openDecisionCount` already come live from `useDecisions({status:'open'})`, so any collapse state
  derived from them follows the data without a reload.
- **The decision card message rendering** keys off `showInlineDecisionCard = shellWidth > 0 &&
  !canSplit`; the pane being present is what suppresses the inline card on desktop. Because a
  decision is what expands the pane, an open decision on desktop always lands in the pane.
- **The composer's block picker (VS-491)** keeps the chosen block on the per-thread draft and sends
  `blockId`; the server stores it on `thread_messages` and returns `ThreadMessage.blockId` on read.
  A block's title comes from `GET /projects/:id/roadmap/blocks` (`useRoadmapBlocks`), which returns
  every block with its stored `status` and derived `reportedStatus`. `useRoadmapBlocks` is keyed per
  project and the SSE handler already invalidates the roadmap root on `roadmap.block.*`.
- **The V2 tag recipe** is `.v2-tag` — the bordered mono chip used by the project tag on a sent
  message, the composer strips, the Work board and the ticket header.
- **Motion** is `--v2-dur-fast/base/slow` plus `--v2-ease`, and a global
  `prefers-reduced-motion: reduce` rule forces every transition and animation to ~0. Using a token
  therefore honours reduced motion for free.

## Goals / Non-Goals

**Goals:**

- Give the conversation back the width an empty decisions pane was holding, without making the pane
  unreachable.
- Keep the collapse live: derived from the open decisions, expanded on arrival, collapsed on the last
  answer, with a deliberate expansion respected while nothing waits.
- Show the block a message was sent with, in the same tag idiom as the project, resolving its title.

**Non-Goals:**

- A device-local layout preference or a bottom/split control — that is V1's `conductor-chat/
  decision-layout`; this is the V2 pane only, and the split stays the desktop layout.
- Showing answered decisions inside the pane. They already render as one muted note in the
  conversation (VS-369/VS-427); "reach the pane" means reach the pane, not a second answered list.
- Any change to the roadmap block lifecycle, the composer picker, the stored message or the server.
- The sibling ticket's Plan-modal tabs work; only the decisions pane and the message metadata row
  change.

## Decisions

### Collapsed means a narrow rail, not a removed pane

When nothing is waiting and the reader has not expanded it, the pane renders as a narrow in-flow rail
(`DECISIONS_RAIL_WIDTH`, ~36px) on the right, not as no element at all. The acceptance asks for a
deliberate way to reach a collapsed pane; a visible rail is that control, is keyboard-operable, never
overlaps the conversation, and matches the shell's own collapsed-sidebar idiom. The alternative — no
element, with the expand control in the status bar — reclaims the rail's last 36px but hides the
affordance, so it was rejected as the weaker reading of "collapsing must not mean unreachable".

The rail carries a vertical "Decisions" label and an expand button (`aria-expanded="false"`). Expanded,
the pane header carries a collapse button; it is rendered only while nothing is waiting, because a
collapse control that cannot collapse (a decision is open) would be a lie.

### Expanded is derived, with one explicit override

```
expanded = canSplit && (openDecisionCount > 0 || panePinned)
```

`panePinned` is the reader's deliberate expansion of an empty pane. It is set by the rail's expand
button and cleared by the header's collapse button or by an effect that fires when
`openDecisionCount` reaches 0. That effect is keyed only on the count, so expanding an empty pane
while the count stays 0 is not undone. The result: a decision appearing expands the pane with no
reload; the last answer collapses it again; a hand-expanded empty pane stays until told otherwise.

No state is persisted. The divider width is already a session choice; whether an empty pane is showing
is a transient reading state, and persisting it would mean a reload could reopen an empty column the
feature exists to avoid. The collapsed state resets to the derived one on mount.

### One `aside` whose width animates between the rail and the divider

The right region stays a single flex child so the conversation reflows smoothly as it changes width.
Its inline `width` moves between `DECISIONS_RAIL_WIDTH` and `divider`, with an inline
`transition: width var(--v2-dur-base) var(--v2-ease)`; the reduced-motion rule already zeroes that
duration. The resizable divider handle (absolute, `-left-1`) renders only when expanded, so a
collapsed rail offers no resize affordance. The pane's content is chosen by state (rail control vs.
header plus cards), so there is no second copy of `V2DecisionCard`.

The existing `showInlineDecisionCard` signal is unchanged: on desktop the pane is expanded exactly
when a decision is open, so "pane present ⇒ no inline card" still holds, and below the threshold the
pane and rail are both absent and the inline card renders as today.

### The block marker resolves from the block list, keyed by the message's project

The message carries `blockId` and `projectId`; the title comes from the block list. Because a thread
spans projects, `ChatPage` collects the distinct `projectId`s among messages that carry a `blockId`
and resolves them with a new `useRoadmapBlockTitles(projectIds)` in `packages/ui/src/api/hooks.ts` —
`useQueries` over the existing `qk.roadmapBlocks(ws, projectId)` key, returning a `Map<blockId,
title>`. Nothing new is fetched for the composer's own project; React Query dedupes the shared key.

A message whose block no longer resolves (deleted, or a project no longer readable) shows no marker,
never the raw id — the requirement is that the marker names a block a reader recognises. The marker is
rendered only when `message.blockId` is set *and* a title resolves, so a message with a project and no
block is byte-for-byte its current self.

### The marker is one more `.v2-tag` in the metadata row, and the row wraps

`ChatMessage`'s metadata row already renders the project tag, the clock, the token count and Reply;
the block tag is inserted directly after the project tag, in the same `.v2-tag text-text-3` recipe.
The row gains `flex-wrap` (and the tags stay `flex-none`) so a long block title wraps to a second
metadata line instead of narrowing or displacing the message bubble; the body is untouched. The prop is
optional (`blockName?: (id: string | null) => string | null`) on `ChatMessage` and
`ChatConversation`, so the Plan modal's planner chat, which passes no block resolver, renders exactly
as it does today.

## Risks / Trade-offs

- [A 36px rail is not literally zero] → it is the deliberate reach the ticket requires; the
  conversation gets back the divider's other ~300–520px, and the rail is a standard collapsed-panel
  affordance. Full removal with a header toggle was considered and rejected above.
- [A hand-expanded empty pane could linger after a decision comes and goes] → the effect keyed on the
  count clears the pin when the count returns to 0, so the automatic collapse wins once nothing waits.
- [A multi-project block fetch could add requests] → only distinct projects that actually appear on
  messages with a block are queried, each under the composer's existing cache key, and the results are
  served from the same query the roadmap screens already use.
- [The metadata row could get long at phone width with project + block + clock + tokens + Reply] →
  `flex-wrap` keeps it inside the bubble's column and the tags truncate; the captures verify both
  themes at phone width.

## Open Questions

None. The one reading worth stating: "look at answered decisions" is taken to mean the pane itself is
reachable, not that answered decisions gain a second home — they stay as the conversation's inline
notes, which is the existing accepted design.
