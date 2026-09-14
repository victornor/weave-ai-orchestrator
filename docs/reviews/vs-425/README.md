# VS-425 — V2 chat stick-to-bottom and streaming reveal (review evidence)

Throwaway evidence from a stubbed-data harness: a Vite-served page mounting the **real**
`useStickToBottom` and `useStreamReveal` (from `packages/ui/src/lib/`), driven in headless Chromium
over CDP so real layout, scrolling, `requestAnimationFrame` and `ResizeObserver` are exercised.
The harness files were deleted; this folder keeps the screenshots and the measured result.

## Root cause, measured

Two defects, both reproduced in the real engine:

1. **Lands short by the container's bottom padding.** The follow scrolled a zero-height sentinel into
   view with `scrollIntoView({ block: 'end' })`. The sentinel is the last child *inside* the scroller,
   so the scroller's `padding-bottom` sits below it and `block: 'end'` stops there. With the chat's
   `py-5` this is **19px short**, inside the 48px at-bottom threshold, so nothing corrects it.
2. **Native smooth scrolls stall under growth.** Re-issuing `scrollTo({ behavior: 'smooth' })` faster
   than the animation completes (a streaming turn, a growing reply) restarts it each time: a target of
   `600` stayed at `100` over 25 growth ticks.

## Scripted run — 50 sends/replies, each reply growing after it lands

`?mode=exact` uses the new path, `?mode=legacy` the old sentinel path. `short` is
`scrollHeight - scrollTop - clientHeight`; `trueShort` is the distance to the real (fractional)
maximum offset, so a 1px reading there is integer rounding, not a short list.

```
mode exact   cycles 50   maxShortPx 0   maxTrueShortPx 0   finalShortPx 0   finalTrueShortPx 0
mode legacy  cycles 50   maxShortPx 19  maxTrueShortPx 19  finalShortPx 19  finalTrueShortPx 19
```

Legacy is the "fails first" case: 19px short on every cycle after the first. Exact is at the true
bottom on all 50.

## Screenshots

- `reply-streaming.png` — a weaver reply mid-reveal (`~300ms` in), the list pinned to the bottom.
- `reply-at-bottom.png` — the same reply settled, full text visible, the view at the exact bottom.
