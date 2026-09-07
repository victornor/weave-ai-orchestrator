## Context

`Chat.tsx`'s pinned decisions `<section>` (around `packages/ui/src/routes/Chat.tsx:699-711`) is
styled from `decisionHeight` (`number | null`, VS-94, `packages/ui/src/lib/decisionHeight.ts`):

```ts
style={
  decisionHeight === null
    ? { maxHeight: 'calc(var(--ac-app-h) * 0.45)' }
    : { height: `${decisionHeight}px`, maxHeight: 'calc(var(--ac-app-h) * 0.75)' }
}
```

`height: Npx` forces the section to exactly `N` pixels regardless of content — the bug. See
proposal.md for why that is wrong once cards are hidden.

## Goals / Non-Goals

- Goal: a chosen height behaves as a maximum at every content size, including zero cards (just the
  hidden-count line) and one short card.
- Goal: no change to the drag, keyboard, persistence or reset code paths — `decisionHeight` still
  holds the same number, written and cleared the same way.
- Non-goal: changing what `decisionHeight` means to callers outside the render (`gauge`, the aria
  attributes, `readBounds`/`clampHeight`) — those already read live geometry each render and need no
  change.

## Decisions

**Drop the unconditional `height`, cap with `maxHeight` instead.** Once a height is chosen, style the
section with `maxHeight: min(${decisionHeight}px, calc(var(--ac-app-h) * 0.75))` and no `height` at
all. Without a forced `height`, the section's block-layout default is content-sized, and `maxHeight`
only stops it from growing past whichever of the two caps is smaller — the chosen height, or the
app's own ceiling (still needed for the keyboard-shrinks-the-viewport case, since a chosen height
that predates the keyboard must still be brought back inside the live viewport).

Alternative considered: keep `height` but recompute it from measured content on every content change
(a `ResizeObserver` on the cards container, clamped to `decisionHeight`). Rejected — `maxHeight` gets
the same behavior from the browser's own layout for free, with no new observer, no extra state, and
no risk of a stale measurement on the frame content changes.

**No change to how `gauge`, `aria-valuenow`, or the drag math read geometry.** They already re-read
`getBoundingClientRect()` every render with no dependency array; a section that is sometimes shorter
than `decisionHeight` is already within what they handle, since content shorter than the *previous*
cap (`calc(var(--ac-app-h) * 0.45)`, the unresized case) is exactly today's existing behavior for the
`decisionHeight === null` branch. This change makes the resized branch behave the same way.

## Risks / Trade-offs

- CSS `min()` inside a `style` object's `maxHeight` string is plain CSS the browser evaluates; jsdom
  (used by the vitest suite) does not lay out flow content or evaluate `min()`/`calc()`, so tests can
  only assert the string that was set, not the resulting rendered height. The existing test suite
  already works this way for the `maxHeight: 'calc(...)'` cases — the hidden-only and
  content-shorter-than-stored cases add assertions of the same shape (style string in, not a real
  rendered box).
- Every existing assertion of the form `area().style.height).toBe('${n}px')` in
  `packages/ui/src/test/chat.test.tsx` (`ChatRoute resizable decisions area` suite) is now testing a
  style property this change stops writing; those assertions move to `area().style.maxHeight`.

## Migration Plan

Single-PR change to one component and its tests; nothing to roll out in stages, no data migration,
no flag.
