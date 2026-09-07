# The phone tab bar is compact, and folds away

Tracker change for [VS-80](conductor://tickets/VS-80). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

The bar takes 78px of chrome plus the safe-area inset off every phone screen, and it is there
whether or not it is wanted. On a 390 × 844 phone with the browser's own chrome that is most of a
message.

Almost none of that height is content. The label is `--fs-nano`, the smallest type token in the
system, and the glyph is 16px: 32px of the 78 is the tab entry. The rest was clearance from the
Start Work button that used to sit half-sunk in the bar's top edge — and VS-81 has since removed
that button, so the 78px is now holding room for nothing at all.

## What changes

- **56px of chrome.** With nothing sunk into the bar the entry needs 48px and the bar needs no more,
  so `--bar-height` and `BAR.height` drop together and every tab stays well past the 44px floor.
  `barGeometry.ts` is still the one place the numbers live and the thumb-target test still reads the
  padding off the rendered DOM, so the rule is checked at 320 · 360 · 375 · 390 · 430px against the
  new height rather than restated.
- **`--bar-inset` becomes the one number the content reserves.** `--bar-height` and the new
  `--bar-handle` stay the two chrome heights; `.ac-bar-pad` reads the inset, and `data-bar` on the
  app shell says which of them is standing there. Nothing else has to learn that the bar can be
  absent.
- **A nub folds the bar away.** 44 × 24px straddling the bar's top-left edge, clear of More's badge
  on the right. What is left is a full-width 24px handle at the bottom edge with a grab mark: the
  way back is the whole bottom edge, tapped or swiped up, not a target to hunt for. The swipe fires
  as it passes the threshold rather than on release.
- **The choice is remembered per device** in `localStorage`, next to the rail's expansion and
  guarded the same way — a bar that cannot remember being hidden must still be there.
- **The keyboard takes the bar with it.** While `data-keyboard` is set (VS-79) the bar, the handle
  and the inset all stand down: the composer is already sitting on the keyboard and a tab bar above
  it is chrome nobody can see past. It is CSS on an attribute the viewport watcher already
  publishes, so there is no frame in which JavaScript and the layout disagree about where the bar
  is, and nothing to animate back — the attribute goes and the bar is there.

The chat re-pins to its bottom on the padding change through `useStickToBottom`'s existing
`ResizeObserver`; no change there.

## Out of scope

Which tabs the bar carries.
