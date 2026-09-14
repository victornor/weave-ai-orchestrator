# Keep the dictation voice meter from driving its own layout

Tracker change for [VS-431](weave://tickets/VS-431).

## Why

Pressing dictate in the V2 Plan modal starts the listening waveform, and the meter grows to the right
without limit until the modal layout is wrecked. The same shared composer in the weaver chat does not
show it.

The mechanism was confirmed in a real browser (Chromium, devicePixelRatio 2, the real `PlanModal` and
`VoiceMeter`): `VoiceMeter` sizes the canvas's backing store from its own layout every rAF frame
(`el.width = Math.round(el.clientWidth * dpr)`, `packages/ui/src/components/VoiceMeter.tsx:51-56`).
A `<canvas>`'s `width`/`height` attributes are presentational hints for its CSS size, so whenever the
canvas's own CSS width does not clamp it, each frame reads a wider box, writes a wider canvas, and
the box grows again — a per-frame feedback loop. Measured at 2^25 px and still climbing. The weaver
chat happens to clamp the width (its composer sits in a `max-w-[720px]` column); the Plan modal's
chat pane has no `min-w-0`, so nothing does. Anything that makes the flex clamp stop applying — a
host without `min-w-0` on the meter, a browser that does not honour `min-width: 0` on a replaced
flex item, a future layout — re-exposes the bug.

The invariant has to live in `VoiceMeter` itself: what is drawn must never determine how large the
element is. The layout clamp in the modal is a second, independent guard.

## What changes

- **`VoiceMeter` decouples the backing store from layout.** The caller's `className` (the sizing
  box: `h-6 min-w-0 flex-1`) moves to a wrapper element; the canvas inside is given an explicit CSS
  size (`display:block; width:100%; height:100%`) so its `width`/`height` attributes can no longer
  leak into layout. The rAF loop measures the wrapper's client box, never the canvas. Rendering and
  colours are unchanged (`--accent` is still read off the element, inherited through the wrapper).
- **The Plan modal constrains its panes.** The chat pane and its parent row get `min-w-0` so no wide
  child — the meter included — can push the modal wider.
- **Tests.** A `VoiceMeter` test proves the canvas backing size stays fixed across frames at
  devicePixelRatio 2 even while the canvas's measured layout width would grow. A Plan modal test
  proves the listening state does not widen the conversation pane.
- **Evidence.** Rendered captures from a real browser at devicePixelRatio 2 with dictation listening
  (stubbed analyser), Plan modal and weaver chat, dark and light, with the meter width measured at
  the start and after several seconds — it must be identical.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `web-v2/chat-composer`: the dictation meter gains a layout-stability requirement — the drawn size
  of the listening waveform must never change the composer's layout, in any host or engine.
- `planning-sessions/v2-modal`: the planning surface gains a requirement that its conversation pane
  is width-constrained and never widens to fit a child.

## Impact

- `packages/ui/src/components/VoiceMeter.tsx` — the fix and its DOM shape.
- `packages/ui/src/v2/PlanModal.tsx` — pane and row `min-w-0`.
- `packages/ui/src/v2/ChatComposer.tsx` — the meter call site (className semantics move to the
  wrapper), no visual change.
- `packages/ui/src/components/Composer.tsx` — V1 call site, same classname move, no visual change.
- New/updated tests under `packages/ui/src/components/` and `packages/ui/src/test/`.
- No server, API, schema or CLI change.
