## Context

See proposal.md — Why.

What exists today, all of it in `packages/ui`:

- `routes/Chat.tsx:532` renders the pinned region as one element:
  `<section aria-label="Open decisions" className="ac-scroll max-h-[calc(var(--ac-app-h)*0.45)] flex-none border-t border-line-1 bg-bg-0 px-4 py-3 md:px-7">`.
  It is a `flex-none` sibling of `PageBody` (the scrolling message list, `flex-1 min-h-0`) and of the
  composer block inside `Page` (`flex h-full min-h-0 flex-col`). The section is rendered at all only
  when `shown.length || hiddenOpen.length`.
- `--ac-app-h` is `100dvh` in `index.css:158` and is overwritten with a pixel height by
  `lib/viewport.ts` while a phone keyboard is open. `.ac-app` (`index.css:386`) is the fixed shell
  sized by it, so every rect measured inside the chat is already measured inside the shown region.
- `lib/stickToBottom.ts` already has a `ResizeObserver` on the scrolling element and its content
  (the "Geometry, not content" effect) which re-pins the list to its bottom, instantly, whenever the
  list's own height changes while the follow is active. The comment names "a decision card pinning
  below it" as the case it was written for.
- `lib/barVisibility.ts` is the shape a per-device view preference takes here: a module-level key,
  a `read`/`write` pair with every `localStorage` access in a `try`, and a safe default when storage
  throws.
- `test/setup.ts` installs a minimal `PointerEvent` but not `setPointerCapture`, and jsdom has no
  layout at all: every `getBoundingClientRect()` is zeros.

## Goals / Non-Goals

**Goals**

- One clamp definition, used by the drag, by the keyboard and by the render, so the three cannot
  disagree about what heights are legal.
- The unresized region stays byte-for-byte today's behaviour, including being no taller than its
  content.
- The message list's stick-to-bottom is not reimplemented: the resize is a geometry change and the
  existing pin effect is what handles those.

**Non-Goals**

- Resizing anything else — the rail, the composer, the worker transcript. Out of scope on the ticket.
- Syncing the height to the daemon or across devices. It is a view preference, like the hidden-card
  state next to it.
- Animating the resize, or a collapsed/expanded toggle. Neither is asked for and a transition would
  fight the pin effect's instant re-scroll.
- Changing which decisions are pinned or hidden (VS-72) or the card's own content (VS-92).

## Decisions

**Store a pixel height, not a fraction.** A drag is measured in pixels and a fraction would have to
be reconstituted from a measurement on every render. The viewport-relative behaviour the requirement
asks for comes from the *clamps* being derived from live geometry rather than from the stored number
being relative — a stored height too large for the current viewport is simply clamped down for as
long as that lasts, and is still there when the keyboard closes. That is also what makes "the height
they chose" survive a rotation rather than being silently rescaled.

**One key for the whole app, not one per workspace.** `conductor.decisions.height`, beside
`conductor.bar.hidden` and `conductor.chat.silentTurns`. The requirement says the height survives
switching workspaces, and there is nothing workspace-specific about how tall a reader wants their
cards. (`hiddenDecisions.ts` is per-workspace because *which* decisions are hidden is.)

**`null` means "not resized", and that is a different rendering, not a default number.** With no
stored height the section keeps today's `max-height: calc(var(--ac-app-h) * 0.45)` and no `height`,
so it is content-sized — a single short card does not become a 45%-tall box. With a stored height it
gets `height: <n>px` and the same `max-height`, so it is exactly that tall and scrolls inside. This
is what makes the reset gesture meaningful: it restores a behaviour, not a number. It also means the
`max-height` utility must stay on the element in both states, which is why it moves from a Tailwind
arbitrary value to the inline `style` alongside `height` rather than being deleted.

**Clamp from the region's own rect, not from a viewport constant.** At the start of a drag or a key
press we read `section.getBoundingClientRect()` and the chat page root's rect:

- `min = MIN_PX` (144) — enough for a card's heading and its action row, measured against the real
  `DecisionCard` rather than guessed; the constant carries that note.
- `max = sectionBottom - pageTop - MIN_LIST_PX` (`MIN_LIST_PX` = 120, a few message lines), floored
  at `MIN_PX` so the range can never invert.

`sectionBottom` is the region's bottom edge, which does not move during a drag because the composer
below it is `flex-none`; `pageTop` is the top of the chat page inside `.ac-app`, which is sized by
`--ac-app-h`. So the maximum *is* "leaves the composer and a few message lines visible" by
construction, and it follows the keyboard without reading a CSS variable — reading a custom property
back through `getComputedStyle` returns the unresolved `100dvh` on a desktop and is not usable.

**The live re-clamp is CSS, not JavaScript.** `max-height: calc(var(--ac-app-h) * 0.75)` on the
section means a height chosen before the keyboard opened is capped by the browser, on the same frame
the variable changes, with no resize listener and no state write. The stored number is left alone,
so closing the keyboard restores the chosen height. 0.75 is the same order as the JS maximum without
having to agree with it exactly: whichever binds first wins, and both leave the composer on screen.

**Drag from an absolute position, not by accumulating deltas.** `next = clamp(dragBottom - clientY)`
where `dragBottom` is captured at pointer-down. Accumulating `movementY` drifts against the clamps —
once the pointer has travelled past the maximum, a delta-based drag needs the whole excess dragged
back before the edge moves, which reads as a dead zone. An absolute mapping has none.

**Move and up are listened for on `window`, and pointer capture is best-effort.** The pointer leaves
a 6px handle immediately. `setPointerCapture` is the right answer in a browser but is absent under
jsdom, so it is called inside a guard (`el.setPointerCapture?.(id)`) and the window listeners are
what the behaviour actually relies on. `touch-action: none` on the handle is what stops a finger
drag from scrolling the page.

**`role="separator"` with `tabIndex={0}` — the ARIA window-splitter pattern.** It is the role for
exactly this widget and it carries `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, which is how the
requirement's "reports the height it is currently set to and the two heights it is clamped between"
is satisfied without inventing anything. Keys: `ArrowUp`/`ArrowDown` by `STEP_PX` (24), `Home` and
`End` to the two clamps (`Home` = smallest, `End` = largest, matching the visual order top-to-bottom
of the region growing), `Enter` and `Escape` reset. Each handled key calls `preventDefault()` so the
message list does not scroll under it.

**`aria-valuenow` before the first resize comes from a measurement, taken once.** A focusable
separator must report a value, and before any resize there is no stored number. A layout effect
records the section's rendered height into a ref when it first lays out and whenever it is resized;
that is what `aria-valuenow` reports until a chosen height replaces it. Under jsdom this measures 0,
so the tests that assert the attribute fake the rect the way `test/components.test.tsx` fakes the
composer's.

**Stick-to-bottom is not touched.** The message list is `PageBody`, already observed by the
`ResizeObserver` in `useStickToBottom`. Shrinking it during a drag fires that observer, which
re-pins instantly when `following.current` is true and does nothing when the human had scrolled up —
which is precisely the requirement. A test asserts it rather than new code implementing it.

## Risks / Trade-offs

- **jsdom has no layout, so every clamp measures zero and collapses to `MIN_PX`.** A test written
  without faked geometry would pass while asserting nothing → the drag, clamp and aria tests define
  `getBoundingClientRect` on the section and the page root (the pattern the KB records for the
  composer's autosize test), and restore it afterwards. The clamp cases are asserted at both ends
  against known fake numbers, so a silently collapsed range fails them.
- **A stored height can outlive the screen it was chosen on** — resized on an external monitor, then
  opened on a laptop. The CSS `max-height` caps it on sight, and the first drag rewrites it. No
  migration and no validation on read beyond "a finite positive number".
- **Storage that throws.** Private mode makes `localStorage` throw on read and on write. Reads fall
  back to `null` (today's behaviour) and writes are swallowed, so the region is still resizable for
  the session and simply does not remember — stated in the requirement so it is not a silent gap.
- **Double-click as the reset gesture is undiscoverable.** It is what the ticket asks for; the
  handle carries a `title` and the keyboard has `Enter`/`Escape` as an equally-documented path. Not
  adding a visible reset button keeps the region's chrome to one 6px strip.
- **Nobody here can drag with a real finger.** Touch is exercised only as synthesised pointer events
  with `pointerType: 'touch'`; `touch-action` is a rendered style, not a behaviour jsdom has. The PR
  says so and the real check is captain's, per the ticket's Verification.

## Migration Plan

None. No stored state to migrate — the key is new and its absence is the pre-change behaviour — and
no server, API or schema change. A client picks the feature up when it loads the new bundle; rolling
back is reverting the commit, after which the key is ignored and every reader is back on the 45%
cap.
