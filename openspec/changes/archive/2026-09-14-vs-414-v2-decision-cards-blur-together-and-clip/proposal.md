# V2 decision cards read as one surface and clip at the bottom

Tracker change for [VS-414](weave://tickets/VS-414). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Two defects in the V2 decision card (`packages/ui/src/v2/DecisionCard.tsx`):

1. **Faint border.** The card's shell is `v2-card`, whose border in `packages/ui/src/v2/v2.css` is
   `1px solid var(--line-1)` — `#17171a` in dark, the same value as `--bg-3` and barely above the
   card's own `--bg-1`. The design reference draws every card with `--line-2`
   (`docs/design/v2/Screens.dc.html`: the narrow chat-pane card, the Needs you card), and V1's
   `components/DecisionCard.tsx` (which the V2 ticket page renders under V2 tokens) already uses
   `border-line-2`. So the V2 card is the one place the border is too faint to separate stacked
   cards.

2. **Bottom clipping in the chat decision pane, not missing padding.** `DecisionsPane`
   (`packages/ui/src/v2/ChatPage.tsx`) stacks cards in a `flex min-h-0 flex-1 flex-col gap-3
   overflow-y-auto` column. Because the card has `overflow-hidden`, its automatic flex minimum size
   is zero, so when the pane's content is taller than the viewport the cards **shrink** and
   `overflow-hidden` clips the content below the border — the bottom action row and the inner
   padding are cut off, which reads as "no padding". The fix is to stop the card shrinking
   (`shrink-0`) so the pane scrolls instead of squashing its children; the padding itself already
   matches the design (12px narrow, 14px wide).

## What changes

- **The V2 decision card's shell uses the visible card border token.** The `article` in
  `packages/ui/src/v2/DecisionCard.tsx` carries `border-line-2` (the `--line-2` design token) instead
  of inheriting `.v2-card`'s `--line-1`; the destructive/discard variant keeps its `border-blocked/35`
  border.
- **The card no longer shrinks as a flex child**, so the chat decision pane scrolls rather than
  clipping a tall card's bottom action row. `overflow-hidden` stays for the rounded corners.
- **A regression test** in `packages/ui/src/test/v2decisions.test.tsx` pins the visible border token,
  the destructive override and the non-shrinking shell.

## Out of scope

- V1's `components/DecisionCard.tsx` is not touched — it already carries `border-line-2`, so the V2
  ticket page (which renders it under V2 tokens) needs no change. V1 at `/` is untouched.
- The held card's stronger border, the Watch preview height/scroll (VS-409) and the Needs you badge
  count (VS-411) are separate tickets.
- Card content, answer behaviour and the pane's own width/clamp are unchanged.
