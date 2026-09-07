## Context

See proposal.md — Why. One component, `packages/ui/src/components/Composer.tsx`, backs every composer in the app; its textarea's `onKeyDown` sends on unmodified Enter unconditionally (line 194). The component already derives `isTouch` from `window.matchMedia('(hover: none)').matches` at render time (line 89) to decide between push-to-talk and tap-to-toggle dictation.

## Goals / Non-Goals

**Goals**

- One signal decides both the key handling and the keyboard hint, so they cannot disagree.
- The desk path stays byte-for-byte the behaviour it is today, including `Shift+Enter`.

**Non-Goals**

- Reacting to a device that changes pointer kind mid-session (a tablet whose keyboard is attached while the composer is open). The requirement explicitly does not ask for it, and subscribing to the media query would mean re-rendering every composer on a hardware event for no observed benefit.
- A per-composer or per-human preference for what Enter does. Nothing asks for one, and adding a setting would need a home in Settings and a persisted scope.
- Any other composer behaviour: dictation, drafts, autosize.

## Decisions

**Reuse `isTouch` from `(hover: none)` rather than sniffing the user agent or `navigator.maxTouchPoints`.** It is already the component's own definition of "touch device", so the mic and the Enter key cannot disagree about what kind of device this is. `maxTouchPoints` is true on a touchscreen laptop that also has a real keyboard, which is exactly the case where Enter should still send. A user-agent string is not a capability.

**Fall through rather than branch inside the handler.** `if (e.key === 'Enter' && !e.shiftKey && !isTouch)` leaves the touch path with no handler code at all, so the browser inserts the newline itself and the textarea's own undo, IME composition and autosize keep working. Calling `preventDefault()` and inserting `'\n'` by hand would break all three.

**`enterKeyHint` only on touch.** `enterKeyHint="enter"` asks the on-screen keyboard for a newline key. On a desk it has no effect at all, but leaving it unset there keeps the DOM honest about which mode the composer is in, and keeps the attribute a readable signal of the branch. `undefined` is how React omits an attribute, so the desktop case renders exactly today's markup.

**No composed-key guard.** An IME's Enter (`e.isComposing`) is a real pre-existing gap on desktop — committing a candidate would send the message — but it is not what this ticket is about and fixing it silently would widen the diff into behaviour nobody asked to change. Noted for the conductor rather than absorbed.

## Risks / Trade-offs

- **`isTouch` is read once, at render.** A tablet that gains a keyboard mid-session keeps the touch behaviour until the composer remounts → accepted by the requirement; the send button works either way, so the failure mode is an extra tap, not a lost message.
- **`window.matchMedia` is missing under jsdom unless a test provides it.** The existing composer and dictation tests already render Composer, so a global stub could change what they exercise → each new case stubs `matchMedia` and restores the original in `afterEach`, and the existing tests are re-run to confirm they still describe the desk case they were written for.
- **Nobody here can press a real on-screen keyboard.** `enterKeyHint` support and the actual key label are the browser's → verified only as a rendered attribute; the real check is captain's, and the PR says so.

## Migration Plan

None. No stored state, no API, no schema. The change takes effect for a client the moment it loads the new bundle; rolling back is reverting the commit.
