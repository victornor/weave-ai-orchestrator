## Context

See proposal.md — Why. The follow's gesture window already exists in `useStickToBottom`
(`packages/ui/src/lib/stickToBottom.ts`, VS-451): a short-lived "the human is scrolling" flag armed
by `wheel`, touch, a scroll key and a scrollbar drag; an off-bottom upward scroll only pauses while
that flag is live. The only gap is where the scroll-key arming is listened for.

## Goals / Non-Goals

**Goals:**

- A scroll key (PageUp/PageDown/Home/End/arrows/Space) that scrolls the transcript pauses the follow
  whatever element has focus.
- Editing keys — the composer's textarea, or any `input`/`select`/`contenteditable` — never arm the
  gesture.

**Non-Goals:**

- Telling which scrollable a key actually moved. The gesture window is 200ms and `onScroll` already
  gates on the transcript having moved up, so arming on a scroll key elsewhere in the page is
  harmless.

## Decisions

- **Listen for scroll keys on `document` rather than on `el`.** The event bubbles to `document` from
  wherever the focused element is, including controls inside the transcript, so one listener covers
  every focus position the scroller-local one could not. The scroller-local `keydown` listener is
  removed, not duplicated.
- **Ignore keys whose `event.target` is editable.** A `keydown` from a textarea/input/select, or from
  any node inside a `contenteditable` host (`target.isContentEditable`), is dropped before arming.
  This is exactly the composer case the ticket names: ArrowUp/Space there edit, they do not scroll.
  No other key filtering: the `SCROLL_KEYS` set stays as VS-451 defined it.
- **Keep every other VS-451 rule.** Only an *upward* off-bottom scroll pauses (`up && human()`), so a
  stray armed window never stops the follow on its own; gestureless reflows, touching and the
  follow's own downward frames are unchanged.

## Risks / Trade-offs

- [A scroll key pressed elsewhere on the page arms the window, so a geometry-only reflow within the
  next 200ms could be read as the human] → The reflow must also move the transcript *up* while off
  the bottom to pause; the flag expires quickly. The alternative — resolving which element a key
  will scroll from the key and the focus — is browser-specific and worse than the existing window.
- [A `keydown` handler on `document` is a permanent listener while the hook is mounted] → It is
  added and removed by the same effect that manages the other listeners, keyed on `el`.
