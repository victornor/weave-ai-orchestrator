## Why

Captain (2026-09-07): after every card in the pinned decisions area is hidden, the area stays as
tall as it was when it held a screenful of cards, showing nothing but a single "N hidden from chat"
line inside a mostly empty strip. The chosen height was meant to be a cap on how tall the area may
grow, but VS-94 wired it as a fixed height instead — once a height is stored, the area renders at
exactly that height "whether its contents need it or not" (the very words the current spec uses),
which is right for the screenful it was chosen against and wrong for everything smaller.

## What Changes

- The area's stored height becomes a maximum, not a fixed size: content shorter than the chosen
  height no longer pads the area out to fill it, including the all-hidden case, which returns to
  being just the hidden-count line tall.
- Dragging, the keyboard controls, persistence per device, and the reset gesture are unchanged —
  only how the stored number is applied to the rendered height changes.
- The handle continues to render above the area's content regardless of how short the content is, so
  it stays grabbable even when the area is at its smallest.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/option-cards`: the requirement "The human sets how tall the pinned region is"
  changes so a chosen height caps the region's height instead of fixing it once contents are
  shorter than the cap.

## Impact

- `packages/ui/src/routes/Chat.tsx`: the inline style applied to the pinned decisions `<section>`
  when a height has been chosen.
- `packages/ui/src/test/chat.test.tsx`: the `ChatRoute resizable decisions area` suite asserts the
  old fixed-height style; it needs new/adjusted cases for the hidden-only and
  content-shorter-than-stored scenarios, and its existing assertions on `area().style.height` need
  to reflect the new styling approach.
- No change to `packages/ui/src/lib/decisionHeight.ts`'s stored value, its clamps, or persistence.
