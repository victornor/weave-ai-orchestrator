# V2 chat reaches its true bottom, and new text streams in

Tracker change for [VS-425](weave://tickets/VS-425). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: "The chat isn't scrolling automatically to the bottom. When I send a message, or
when a message from the weaver appears, it sometimes doesn't scroll to the bottom. It seems to scroll
down, but not all the way. Maybe it scrolls too early. It could also be a smooth scroll instead of
janking down." And: "the processed text should come in animated, like it's streaming in, just fast,
so it doesn't appear out of nowhere. And when a weaver chat message comes in, the final one, it
should look like it's streamed in."

Two root causes, both demonstrated in real headless Chromium before writing any fix (scripts and
measured numbers are in the report document; the short version):

1. **The list lands short by the container's bottom padding.** `useStickToBottom` scrolls a
   zero-height sentinel into view with `scrollIntoView({ block: 'end' })`. The sentinel is the last
   child *inside* the scrolling element, so it sits `padding-bottom` above the scroll container's true
   bottom. `block: 'end'` aligns the sentinel's bottom with the scrollport bottom and stops there:
   measured `scrollTop 681` against a true bottom of `700` with `padding: 20px 0`, i.e. 19px short.
   `48px` is inside the at-bottom threshold, so nothing corrects it — the follow believes it is at the
   bottom while it is not.
2. **Re-issuing a native smooth scroll faster than it can finish stalls it.** The chat follows
   `[messages.data, liveEvents.length]`; while a turn streams, every event re-issues
   `scrollTo({ behavior: 'smooth' })`. Each call restarts the animation from wherever the list is, so
   during a burst it never advances: measured a target of `600` with the list stuck at `100` over 25
   growth ticks. This is the intermittent "doesn't scroll, or janks down" half.

## What changes

- **`useStickToBottom` gains an `exact` mode** (used by V2; V1 keeps its current behaviour). In it,
  "the bottom" is the scroll element's own `scrollHeight - clientHeight`, never a sentinel's
  position, so a padded container cannot leave a gap.
- **Smooth follow is driven by `requestAnimationFrame`, not the browser's smooth-scroll animation.**
  One animation loop eases `scrollTop` toward a bottom recomputed every frame, so it tracks content
  that grows mid-scroll (a streaming reveal) and always settles exactly on the final
  `scrollHeight - clientHeight`; it stops the moment the human scrolls up, so the existing
  pause/scroll-to-bottom/unread behaviour is preserved.
- **A streaming reveal** (`lib/streamReveal.ts` + `<StreamingText>`): new weaver replies reveal
  character by character in ~420ms, and dictated text reveals into the composer the same way. Both go
  straight to the full text under `prefers-reduced-motion`.
- **Reveal only what is genuinely new.** A message already on screen when the chat opens, or paged in
  from history, renders in full and never re-animates.
- **Tests** for pinning through late growth, reveal-only-new-messages, and reduced motion, in a new
  `stickToBottom.test.tsx` and additions to the V2 chat/composer suites.

## Out of scope

- V1's chat scroll behaviour (kept exactly as it is; the new mode is opt-in).
- Work board animations and the general motion polish pass (separate tickets).
