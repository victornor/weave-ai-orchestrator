# VS-451 — V2 chat lands at the bottom on send, and never pauses without a real scroll

Throwaway evidence from a stubbed-data harness: a Chromium page mounting the **real**
`useStickToBottom` (compiled straight from `packages/ui/src/lib/stickToBottom.ts`), driven headless
over CDP so real layout, scrolling, `requestAnimationFrame` and `ResizeObserver` are exercised. No
daemon, no runtime, no credentials. The harness files were deleted; this folder keeps the measured
result and the captures.

## Method

- The harness renders a fixed-height scroll list with `padding: 20px 0` (the V2 chat's `py-5`), a
  content column of tall messages, and a composer below it — the same flex layout `ChatPage` uses.
  It drives the real hook with `exact: true` and `signal = [messages]`.
- The driver runs, per mode: `50` **scroll-up-then-send** cycles (`WheelEvent` up, wait for the
  pause, send, wait for the follow), then a 30-frame reply **growth/reveal** while following, a
  **composer growth** (dictation) while following, a **content shrink** (a live trace collapsing to
  its summary), and a **gestureless upward scroll** (what scroll anchoring or a reflow above the
  viewport produces — no wheel, no touch). It counts an *unintended pause* as `following` flipping
  from true to false with no gesture in the last 400ms.
- **before** = the hook at `HEAD` (`3f1c1cd2`) and sending **without** `toBottom()` (the shipped
  `ChatPage.send`). **after** = the VS-451 hook and sending **with** `toBottom()`.
- `short` is `scrollHeight - clientHeight - scrollTop`, i.e. the distance from the true bottom. The
  `exact` follow settles by writing `scrollTop = scrollHeight`, which the engine clamps to the true
  maximum, so 0 here is exact.

## Results

```
mode   cycles  maxShort  finalShort  sends-resumed  unintended pauses  capture-short
before   50      311        311          0 / 50            1                311
after    50        0          0         50 / 50            0                  0
```

- **Cause #1 — sending did not return to the bottom.** `before`, every one of the 50 sends left the
  view `311px` from the bottom, `following` false: exactly captain's report. `after`, every send
  lands at `0px` and resumes following (`50/50`).
- **Cause #2 — a scroll with no human behind it paused the follow.** `before`, the gestureless
  upward scroll flipped `following` to false (the `1` unintended pause); `after`, it does not
  (`0`). The geometry-only movers — reply/reveal growth (30 frames, `growthPauses 0`), the composer
  growing under dictation, a collapsing trace, content shrink — never pause in either build, because
  a list clamped to its new maximum lands *at* the new bottom; the gestureless upward scroll is the
  reachable case where the old code cannot tell the browser's move from the human's.

## Captures

- `send-from-scrolled-up-after.png` — after a send from a scrolled-up position: at the true bottom,
  the newest message visible, `short 0`, `following true`.
- `send-from-scrolled-up-before.png` — the same send on the shipped code: still `311px` short,
  `following false`, the newest message below the fold.