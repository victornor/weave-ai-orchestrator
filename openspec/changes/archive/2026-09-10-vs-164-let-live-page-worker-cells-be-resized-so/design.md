## Context

See `proposal.md`. Constraints that shape the approach:

- Live cells are a CSS grid in `packages/ui/src/routes/Live.tsx`: `grid gap-3 sm:grid-cols-2 xl:grid-cols-3`. Each cell is an `ac-card` whose transcript is capped at `max-h-[calc(var(--ac-app-h)*0.25)]` (`0.3` from `md`). There is no size state today.
- jsdom has no layout. Tests cannot assert geometry; they assert attributes, classes and styles the way VS-94's decision-height tests do. jsdom also drops `touch-action`, so assert `touch-none`. `setPointerCapture` is best-effort (`?.`).
- VS-94 already has the pointer-drag + keyboard + guarded-storage pattern (`packages/ui/src/lib/decisionHeight.ts`, Chat.tsx). Reuse the gesture, not the pixel-height model: a pixel width in a wrapping grid does not reflow neighbours.
- Phone keyboard / visual viewport: size against `--ac-app-h`, never raw `vh`. The page already does.
- Worker ids are ULIDs and workers are disposable. A durable `localStorage` map keyed by worker id accumulates dead keys; session storage does not.

## Goals / Non-Goals

**Goals:**

- Integer grid spans so CSS grid auto-placement is the reflow.
- A drag handle that works under jsdom (pointer events on `window`, write size at pointerup).
- A phone path that cannot steal the scroll gesture.
- Session-only persistence, stated as such.

**Non-Goals:**

- A layout library (`react-grid-layout` and friends).
- Pixel-precise freeform resize, masonry packing, or a splitter that shrinks a neighbour in lockstep.
- Remembering sizes across tabs, devices, or after the worker has left the live set.
- Changing membership, streaming, or empty/loading/error.

## Decisions

### D1. Size is `{ cols, rows }` integer spans, default `{1,1}`

The visual grid stays `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`. A cell's size is `grid-column: span N` / `grid-row: span N`, clamped to the current column count (1 below `sm`, 2 from `sm`, 3 from `xl`) and to row span 1 or 2.

`{1,1}` is today's equal slot. Growing `cols` to 2 on a 2-column grid makes that cell full-width and wraps neighbours below it. Growing `rows` to 2 makes it taller; the transcript `max-h` scales with `rows` (the existing `0.25`/`0.3` of `--ac-app-h`, times `rows`) so "see more" is the extra transcript, not empty card chrome.

Dragging snaps to the next span, not to free pixels: the pointer's offset from the cell's origin, divided by the cell's unresized width/height (measured at pointerdown), rounded and clamped. A drag that does not cross a span threshold writes nothing — same "press without a move changes nothing" rule as VS-94.

**Rejected:** pixel width/height (neighbours do not reflow; tests cannot see it). **Rejected:** a denser 6-column track (more span resolution, but the visual contract is 2/3 columns and the extra tracks are invisible complexity). **Rejected:** a new dependency.

### D2. Handle on the bottom-right corner, plus keyboard

One visible handle at the bottom-right of the cell (`sm:flex`, `hidden` below `sm`). `role="separator"`, `aria-orientation="horizontal"` is a lie for 2-axis resize — use `aria-label="Resize {worker name}"` and `tabIndex={0}` instead of faking a 1-axis slider. Arrow keys step one span: Right/Left → `cols` ± 1, Down/Up → `rows` ± 1. Escape / double-click resets to `{1,1}`.

Pointer: `pointerdown` on the handle captures (best-effort), `pointermove`/`pointerup`/`pointercancel` on `window`. `touch-none` on the handle. The ticket link in the header stays the only navigation; the handle is not inside it.

**Rejected:** dragging the cell body (selecting/copying transcript must keep working). **Rejected:** a CSS `resize` on the card (no snap-to-span, no keyboard, no tests).

### D3. Phone is tap-to-expand, independently per cell

Below `sm` the drag handle is not rendered (`hidden sm:flex` is not enough on its own — a `hidden` handle is still in the accessibility tree on some browsers). Do not mount the handle below `sm`; mount an "Expand" / "Restore" button in the cell header instead (`sm:hidden`). One cell expanding does not collapse the others. Expanded means `rows: 2` effectively (larger transcript max-height); restore is `rows: 1`.

Breakpoint is Tailwind `sm` (40rem), matching the grid's own `sm:grid-cols-2`. Tests drive the two controls by presence, not by faking viewport width: both controls can be asserted by class / `hidden` if a single render includes them, **or** a `matchMedia` stub if the handle is not mounted. Prefer not mounting the handle below `sm` so a finger cannot start a drag; a small `useMinSm()` (or existing breakpoint helper if one exists) is fine. If none exists, `window.matchMedia('(min-width: 40rem)')` with a test stub.

**Rejected:** height-only drag on the phone (fights scroll; VS-94 got away with it because the handle is a 12px sticky strip at the top of a pinned region, not a card in a scrolling page). **Rejected:** a single "focus this worker" fullscreen (hides the floor; out of the "grid reflows" request).

### D4. `sessionStorage`, per workspace, per worker, guarded

New helper `packages/ui/src/lib/liveCellSize.ts`, same try/catch as `decisionHeight.ts`:

- Key: `conductor.live.cellSizes.<wsId>`
- Value: `{ [workerId]: { cols: 1|2|3, rows: 1|2, expanded?: boolean } }`
- Corrupt / unreadable / non-finite → treat as never resized
- Write on pointerup / keyboard / expand-toggle, not on every move
- Drop keys for workers no longer in the live set when the map is written, so a long session does not keep corpses
- `null`/missing entry = `{ cols: 1, rows: 1 }` (never resized)

`sessionStorage` is already cleared between ui tests (`src/test/setup.ts`).

**Rejected:** `localStorage` (dead worker ids pile up; sizes are not a device preference the way decision-card height is). **Rejected:** URL state (not shareable, noisy). **Rejected:** daemon persistence (no API change in this ticket).

### D5. No library, no daemon, no PLAN edit

Live is already in the rail. Resizing is a property of a cell, not a new section. PLAN §21.1 stays.

## Risks / Trade-offs

- [CSS grid auto-placement can leave a hole when a 2-col cell sits next to a 1-col cell on a 3-col grid] → accepted; `grid-flow-dense` on the container fills holes. If dense reordering feels jumpy, drop it and live with the hole — still usable, still not an overlay.
- [Span snap feels coarse (only 1× / 2×)] → accepted for v1; the ticket asked for larger vs smaller, not pixel tweaking.
- [Phone expand is independent, so three expanded cells stack tall] → accepted; the human can restore. Do not auto-collapse.
- [jsdom cannot prove reflow] → tests assert `gridColumn` / `gridRow` (or equivalent style/data attributes) and that neighbours remain in the document; visual packing is CSS's job.
- [A worker that leaves and rejoins under a new id loses its size] → correct; that is a new worker.

## Migration Plan

None. No stored data, no API, no flag. Rollback is revert.

## Open Questions

None. Persistence is session-only (stated). Phone is tap-to-expand (stated). Span model is a design choice inside the accepted contract.
