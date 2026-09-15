# VS-460 — a scroll key pressed outside the transcript pauses the follow

Throwaway evidence from a stubbed-data harness: a headless-Chromium page mounting the **real**
`useStickToBottom` (bundled straight from `packages/ui/src/lib/stickToBottom.ts`) with real layout,
scrolling, `requestAnimationFrame` and `ResizeObserver`. No daemon, no runtime, no credentials. The
harness files were deleted; this folder keeps the measured result.

## Method

- The page mirrors the V2 chat: a header, a fixed-height scroll container with 40 tall messages each
  carrying a link, and a composer below it. The real hook runs with `exact: true` and
  `signal = [messages]`.
- The driver (CDP over Chromium's remote-debugging port) lands the list at the bottom, then clicks a
  visible point in the transcript. The clicked container is not focusable, so `document.activeElement`
  stays `BODY`, but Chromium remembers the transcript as the keyboard scroll target — this is the
  reported case: a key pressed while focus is outside the transcript still scrolls it.
- It then dispatches a **real** `PageUp` (`Input.dispatchKeyEvent`, not a synthetic event), waits,
  and appends one more message (the next streamed line), and reads the follow state each time.
  `distance` is `scrollHeight - clientHeight - scrollTop` — 0 is the true bottom.
- **before** = the hook at `HEAD` (listener on the scroller, `3f1c1cd2`-era VS-451 code).
  **after** = the VS-460 hook (listener on `document`).

## Results

```
variant  click focus  after PageUp               after next line
         active       following  distance         following  distance
before   BODY         true       482               true        0      <- yanked back down
after    BODY         false      482               false       538    <- stayed up
```

- Before the fix, the `PageUp` scrolled the transcript while no `keydown` reached the scroller, so the
  move read as gestureless and `following` stayed `true`; the next line then pulled the view from
  `482px` back to the bottom (`distance 0`) — exactly the reported yank.
- After the fix, the `document` listener arms the gesture, the follow pauses (`following false`) and
  the next line leaves the view where the human left it (`distance 538`).
