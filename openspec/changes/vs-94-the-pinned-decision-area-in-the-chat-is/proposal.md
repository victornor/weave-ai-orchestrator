## Why

The conductor chat pins every open decision in a region between the message list and the composer, capped at a fixed 45% of the app height (`Chat.tsx:532`, `max-h-[calc(var(--ac-app-h)*0.45)]`). That fraction is a guess made once for every reader, every screen and every question. A long plan approval with four options is read three lines at a time through the region's own scrollbar, and there is no way to trade conversation space for card space; on a laptop with a tall window the opposite is true and 45% is more than the cards need. Captain (2026-09-07): "Make the decision card view in the chat adjustable in height, by allowing the user to drag the top line of the container."

## What Changes

- The top edge of the pinned decisions region becomes a drag handle. Dragging it up makes the region taller and the message list shorter; dragging it down does the reverse. Pointer, touch and pen all drive it through the same pointer events.
- The height is clamped live: never below what shows one card's header and its action row, never above what still leaves the composer and a few lines of conversation on screen. The upper clamp is derived from the region's live geometry inside `--ac-app-h`, so it tightens on its own when a phone keyboard shrinks the viewport.
- The chosen height is remembered per device in `localStorage`, under one key for the whole app rather than one per workspace, so switching workspace or reloading keeps it. A double-click or double-tap on the handle forgets it and returns the region to today's behaviour.
- Until the human has resized it, the region behaves exactly as it does today: capped at 45% and no taller than its content. Once resized, it is exactly the height they chose and scrolls inside that.
- The handle is focusable and is an ARIA window splitter: arrow keys resize it, Home and End go to the two clamps, Enter and Escape restore the default, and it carries an accessible name and its current value.
- With no open and no hidden decisions the region is not rendered at all, exactly as today; the stored height applies again the next time a card appears.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/option-cards`: the requirement that bounds the pinned region to "a part of the viewport" now says that bound is adjustable by dragging the region's top edge and remembered per device, with the clamps and the reset spelled out.

## Impact

- `packages/ui/src/lib/decisionHeight.ts` (new) — the stored height, its clamps, and the reset. Follows `lib/barVisibility.ts`: guarded `localStorage`, a safe default when storage throws.
- `packages/ui/src/routes/Chat.tsx` — the `<section aria-label="Open decisions">` gains a handle child, a measured drag, and an inline height; its `max-h-` utility becomes a `max-height` that keeps following `--ac-app-h`.
- `packages/ui/src/test/chat.test.tsx` — new cases for the drag, both clamps, persistence across a remount, the reset, and the message list still following its bottom after a resize. The six existing "Open decisions" assertions are unchanged.
- No server, API, CLI, schema or data-model change. Nothing is sent to the daemon and no other device is affected.
