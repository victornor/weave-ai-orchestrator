# Global Chats: the collapse button points the way the pane collapses

Tracker change for [VS-341](weave://tickets/VS-341). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

The pane header's collapse button shows the glyph `⟨` (U+27E8), an arrow pointing left. Collapsing
takes the pane to a sliver, which reads as a move to the right, so the arrow gestures against the
motion. Captain asked for exactly one thing: make it point right.

## What changes

- `packages/ui/src/routes/GlobalChats.tsx`'s collapse button renders `⟩` (U+27E9) instead of `⟨`.

## Out of scope

The expand sliver, the reorder menu, and the layout are untouched. No test asserts the glyph, so
none is updated.
