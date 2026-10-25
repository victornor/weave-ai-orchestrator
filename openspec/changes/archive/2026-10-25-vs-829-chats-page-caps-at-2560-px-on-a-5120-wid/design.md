## Context

`V2ChatsScreen` renders `<section style={{ flexGrow: weight, flexBasis: 0 }}>` panes inside
`<div className="flex h-full min-h-0 overflow-x-auto">`. There is no `max-width` anywhere above it:
`V2Root` sets `v2-root flex h-[100dvh]` with no width rule, `V2Shell`'s content column is
`flex-1 min-w-0`, `V2Page`'s body is `flex-1` (or `overflow-y-auto`, which only bounds height), and
`index.css` has a single `max-width: 100%` on `ac-chat-prose`'s https links. The pans therefore do
stretch to the window; what stops short on a wide screen is the *content* inside each pane:

- `ChatPage.tsx` wraps the composer in `mx-auto w-full max-w-[720px]`.
- `ChatConversation.tsx` wraps the message list in `mx-auto w-full max-w-[720px]`.

So a pane of 2560 px (two panes on a 5120 px window, rail excluded) shows a 720 px column centred in it:
an 1840 px void. The design mockup asked for this (`Screens.dc.html`: chat text max 620/740 px), which
is right for a full-width single chat but wrong for a pane that is already a third of the screen.

`chatSplit.ts` already owns the chat's geometry (`SPLIT_MIN_WIDTH`, `DIVIDER_MIN/MAX`, `useElementWidth`
on the chat shell). It is the natural owner for the measure too.

## Goals / Non-Goals

**Goals:**

- One pure function decides the conversation measure from the chat region's width, so the composer and
  the message list can never disagree again.
- Keep today's reading width on ordinary desktops (below the threshold nothing changes visually).
- The tests exercise the resolver as a pure function (jsdom cannot measure layout), and the rendered
  widths are confirmed in a real browser at 1280/1920/2560/5120.

**Non-Goals:**

- Not touching the pane row's flex model, the drag weights, the collapsed 40 px sliver, or
  `globalChatLayout`.
- Not compensating for the operator's display scaling: if the pane fills the CSS viewport but the
  viewport is 2560 CSS px because of a 2× scale factor, that is reported as a measurement, not fixed.
- Not changing other centred columns (Needs you, Incidents, Roles), which the mockup bounds on purpose.

## Decisions

**Decision: a width resolver in `chatSplit.ts`, applied by the two call sites.**

```ts
/** Message/composer reading measure: a reading width that widens with a wide region. */
export const CONVERSATION_READING_WIDTH = 720;
/** Above this region width the column widens with the region instead of staying centred. */
export const CONVERSATION_WIDEN_AT = 1600;
/** The widest the column ever gets (about a third of a 5120px window's half-pane row). */
export const CONVERSATION_MAX_WIDTH = 1720;

export function conversationMeasure(regionWidth: number): number {
  if (regionWidth <= CONVERSATION_WIDEN_AT) return CONVERSATION_READING_WIDTH;
  return Math.min(CONVERSATION_MAX_WIDTH, Math.round(regionWidth * 0.75));
}
```

- Below 1600 px of region the answer is the current 720 px, so nothing moves on a laptop.
- At 2560 px (one pane of two on a 5120 window) it resolves to 1720 px — the pane is used instead of
  half wasted — and stays there: a line of prose much wider than ~1700 px is unreadable, and the ticket
  asks the *panes* to fill the width, which they already do; the conversation column is what has to
  catch up.
- Chosen over `max-w-[min(100%,...)]` at each site because that duplicates the rule again and leaves
  two owners; chosen over a single unbounded `max-w-none` because a 2560 px measure would make every
  paragraph a single unreadable line.
- The join with `SPLIT_MIN_WIDTH`: below 620 px the region is a phone/narrow split and the 720 px
  reading width is wider than the region, so the existing `w-full` keeps behaviour — the resolver only
  ever *reduces* nothing; it is applied as an inline `width: min(100%, measure)` via
  `maxWidth` so a narrow region still fills.

**Decision: apply as an inline `maxWidth` + `w-full mx-auto` at both sites, fed from the existing
`useElementWidth` measurement of the chat shell.**

`ChatPage` already measures the chat shell for `shouldSplit(shellWidth)`. The conversation column is a
sibling of the decisions pane inside that shell, so its width is the shell minus the pane/divider, but
`conversationMeasure` is monotone and the difference is small compared with the thresholds; using the
shell width keeps one observer and the existing test seams. To be exact at the boundary the conversation
sub-column gets its own `useElementWidth` ref — the same hook, no new code — and the resolver is fed that.
`ChatConversation` receives the measure as a `<720px>` style prop from `ChatPage` rather than measuring
itself, so the composer and the list share one value by construction and the pure test covers both.

**Decision: tests.**

- Pure: `conversationMeasure` table across 320, 620, 1280, 1600, 1601, 1920, 2560, 3840, 5120 —
  monotone, never below the reading width above the threshold, clamped at the maximum, exact at the
  boundary.
- Component: render `V2ChatsScreen` at a wide `matchMedia`/`ResizeObserver` stub and assert the composer
  and message column carry the same resolved `maxWidth`. (Geometry itself is verified visually.)

## Risks / Trade-offs

- [A pane narrower than the reading width on a mid-size screen] → `width: min(100%, measure)` never
  exceeds its parent; the existing `w-full` path for narrow regions is unchanged.
- [Two call sites drift again] → one exported resolver plus a component test asserting both sites carry
  the same value.
- [The real cause is display scaling, not CSS] → the verification note records `window.innerWidth` and
  `devicePixelRatio`; if the CSS viewport is 2560 px, the report says so and the layout change stands on
  its own merit (a half-pane still shows a 720 px strip).

## Migration Plan

Single PR, no migration; the layout change is purely additive to a UI package and reverts by reverting
the commit.
