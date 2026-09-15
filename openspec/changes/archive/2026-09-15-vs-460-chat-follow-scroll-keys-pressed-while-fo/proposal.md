# Scroll keys pressed outside the transcript still pause the follow

Tracker change for [VS-460](weave://tickets/VS-460). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-451 (PR #382, merged 2026-09-14) changed `packages/ui/src/lib/stickToBottom.ts` so that only a
real gesture pauses the transcript's follow. Its scroll-key check is a `keydown` listener on the
scroller itself (`el.addEventListener('keydown', onKeyDown)`).

When focus is elsewhere — the page body, a button in the chat, a message link — PageUp, Space, Home
and the arrow keys still scroll the transcript, because the browser routes them to the nearest
scrollable. No `keydown` reaches `el`, so the upward move is classified as gestureless and the
follow never pauses; the next streamed line pulls the view back to the bottom. Before VS-451 any
upward scroll paused, so for keyboard readers this is a regression.

## What changes

- **`useStickToBottom` recognises scroll keys wherever focus is.** The scroll-key gesture is armed
  from a `document`-level `keydown` listener (the scroller-local listener it replaces could only
  ever see keys pressed inside the list), for the same `SCROLL_KEYS` set. Keys whose target is
  editable — `input`, `textarea`, `select`, `contenteditable` (the composer) — are ignored, because
  there an arrow or Space moves the caret or types rather than scrolling.
- **VS-451's other behaviour is unchanged:** a gestureless reflow never pauses, a downward move
  never pauses, typing in the composer never pauses, and the follow's own downward frames inside
  the gesture window are never mistaken for the human. The button, unread marker, older-page paging
  and reduced-motion jump are untouched; V1 (the sentinel path) shares the hook and gets the same
  fix.
- **Tests** in `packages/ui/src/test/stickToBottom.test.tsx`: PageUp or ArrowUp with focus on
  `document.body`, and a scroll key targeting a message control outside the scroller, pause the
  follow; ArrowUp, Space or PageDown on an `input`/`textarea`/`contenteditable` do not; every
  VS-451 case still passes.
- **Evidence:** the ticket asks for a real-browser check. A throwaway headless-Chromium harness in
  the style of VS-451's (real layout and `requestAnimationFrame`, no daemon and no credentials)
  runs the actual hook: from a scrolled-to-bottom streaming chat, focus a message link, press
  PageUp, and measure that the view stays up while new lines arrive. Before/after distances and the
  pause behaviour are recorded in the pull request.
- `pnpm lint`, `pnpm typecheck` and both test suites pass.

## Out of scope

- Any other scroll or follow behaviour change.
