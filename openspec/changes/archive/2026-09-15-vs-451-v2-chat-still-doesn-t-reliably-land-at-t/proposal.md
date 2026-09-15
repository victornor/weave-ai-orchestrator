# V2 chat always lands at the bottom on send, and never pauses without a real scroll

Tracker change for [VS-451](weave://tickets/VS-451). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14 22:42 (on the release that already includes VS-425): "We're still not scrolling
to the bottom… sending messages and not taking me to the bottom… scrolling to the bottom is just not
really perfect yet." Two distinct defects, both in the V2 chat:

1. **Sending never returns to the bottom.** `ChatPage.send` posts the message but never calls
   `stick.toBottom()`. The follow is only resumed when the list reaches the bottom by hand or the
   button is pressed, so once a scroll (even an accidental one) pauses it, the human's own message
   and the weaver's reply render below the fold. This is the literal report: sending does not take
   them to the bottom.
2. **The follow pauses without the human scrolling.** `useStickToBottom`'s scroll listener treats any
   upward `scrollTop` move as "the human scrolled up". But the browser moves `scrollTop` on its own:
   content shrinking under a list clamped at its end, a prepended older page under scroll anchoring,
   and — most reachable on this screen — the composer growing (dictation) so the list gets shorter
   and its maximum offset drops, clamping `scrollTop` down. That is read as an upward scroll, the
   follow pauses, and the next reply lands out of view.

## What changes

- **`useStickToBottom` pauses only on a real gesture.** The scroll listener keeps a short-lived
  "the human is scrolling" flag armed by `wheel`, `touchstart`/`touchmove`/`touchend`, the browser's
  scroll keys, and a pointer drag that starts on the scroller itself (the scrollbar). Only an
  off-bottom scroll inside that window pauses `following`; a scroll with no gesture behind it never
  does. The existing button, unread marker, older-page paging and reduced-motion jump are unchanged;
  V1 (the sentinel path) keeps the same hook and gets the same fix.
- **`ChatPage.send` always calls `toBottom()`** on a successful send and on a queued one (offline or
  a network failure): jump to the true bottom and resume following, so the human's message and the
  weaver's reply stay in view. The dictation composer routes through the same `send`, so it is
  covered; the Plan modal (VS-442) and the floating dictation bar (VS-450) pick it up from the same
  `send` when they land.
- **Tests:** the shared hook gets gesture-vs-reflow cases (wheel and touch pause; a bare scroll,
  content shrink/geometry change and a prepended older page do not; a scrollbar drag pauses but a
  message click does not), and the V2 chat gets send-while-paused returning to the bottom and
  following the reply.
- **Evidence:** a scripted real-browser run in the style of VS-425's harness (headless Chromium, real
  layout): 50 scroll-up-then-send cycles, growth/reveal while following, and composer growth, with
  max and final distance from the true bottom and a count of unintended pauses, before and after the
  fix, plus a capture of the chat at the bottom after a send.

## Out of scope

- VS-447's jump-to-response (in progress on its own branch): it pauses the follow on purpose and
  calls `toBottom()` on the next send, which this change keeps working.
- VS-442 (Plan modal conversation) and VS-450 (floating dictation bar): not in main yet; both send
  through the shared `ChatComposer` → `send`, so they inherit the fix when they land.