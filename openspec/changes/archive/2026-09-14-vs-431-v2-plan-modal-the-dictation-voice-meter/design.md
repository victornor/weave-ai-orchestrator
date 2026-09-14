## Context

`VoiceMeter` (`packages/ui/src/components/VoiceMeter.tsx`) is the shared listening waveform behind
the composer's mic in both V1 (`components/Composer.tsx`) and V2 (`v2/ChatComposer.tsx`), and the V2
Plan modal uses the V2 `ChatComposer` (VS-428). It draws on a canvas from a `requestAnimationFrame`
loop; React never re-renders for audio.

Each frame it does:

```ts
const dpr = window.devicePixelRatio || 1;
const w = el.clientWidth;
const h = el.clientHeight;
if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
}
```

The canvas carries only the caller's sizing class (`h-6 min-w-0 flex-1` from
`ChatComposer.tsx:388`; `h-8 min-w-0 flex-1` from `Composer.tsx:511`) and no CSS `width`. A
`<canvas>`'s `width`/`height` attributes are presentational hints for its CSS size, so when the flex
clamp does not apply the attribute *is* the element's width: the next frame's `clientWidth` is the
previous frame's `dpr`-scaled attribute, and the element grows geometrically.

**Confirmed in a real browser** (Chromium 1243, `deviceScaleFactor: 2`, the real `PlanModal` +
`ChatComposer` + `VoiceMeter` on a Vite harness with the real `index.css`/`v2.css`): with the flex
utilities absent from the canvas the meter reached `width: 33,554,432px` and kept climbing — the
reported symptom exactly. With `flex-1`/`min-w-0` present it held steady at 393 px at every viewport
and DPR tested (375–1440; dpr 1, 1.5, 2, 3), so the production trigger is a host/engine where the
clamp does not hold (e.g. a browser that does not honour `min-width: 0` on a replaced flex item).
The fix must therefore not depend on the clamp.

## Goals / Non-Goals

**Goals:**

- A canvas's drawn size can never change its laid-out size, in any host, on any engine, now or after
  a future layout change.
- The Plan modal's conversation pane cannot be widened by a child.
- The existing waveform rendering, geometry, timing and colours are unchanged.
- The bug is locked out by tests and by real-browser evidence at devicePixelRatio 2.

**Non-Goals:**

- The dictation reveal animation (VS-425) and the broader motion pass (VS-427).
- Any change to `useDictation`, the transcription pipeline, or when the meter is shown.
- Any server, API, schema or CLI change.

## Decisions

### D1: A sized wrapper owns the layout; the canvas is 100% of it

`VoiceMeter` renders a wrapper element that receives the caller's `className` (the flex item:
`h-6 min-w-0 flex-1`, or `h-8 …` in V1) and a canvas inside it with its own explicit CSS size
(`block h-full w-full`). The wrapper's width comes from layout; the canvas is exactly that box. The
attribute can no longer be the element's layout size, so the feedback loop is structurally
impossible rather than merely unobserved.

Rejected alternative: keep the canvas as the flex item and add `width: 100%` / `height: 100%` inline.
It works for the width but `height: 100%` resolves against a parent whose height is in turn driven by
the canvas, so it can still be circular, and it leaves the meter's own size decided by the caller's
class rather than owned by the component.

### D2: Measure the wrapper, never the canvas

The frame reads `wrap.clientWidth` / `wrap.clientHeight` (with a guard for 0, which jsdom and a
pre-layout first frame both produce) and sets the backing store from that. The canvas's
`clientWidth` is never read, so the measurement can never observe the attribute it just wrote.

### D3: `--accent` is read from the wrapper

The wrapper is where the token is inherited, and custom properties inherit, so
`getComputedStyle(wrap).getPropertyValue('--accent')` yields the same value the canvas did. The
existing fallback (`#5e6ad2`) stays.

### D4: `min-w-0` on the Plan modal's panes

`PlanModal.tsx`'s chat pane (`section`) and its flex parent row get `min-w-0`, matching the weaver
chat's `max-w-[720px]` column. This is a defence in depth: even a future wide child cannot widen the
modal, and it is what the surface's own requirement asks for.

### D5: Tests, and what each can and cannot prove

- **VoiceMeter (jsdom).** Fake `requestAnimationFrame`, define the wrapper's `clientWidth` as a fixed
  value, and define the canvas's `clientWidth` to return the previous backing width — the feedback
  the bug produced. Run several frames at `devicePixelRatio = 2` and assert the backing width stays
  `wrapperWidth * 2`. This asserts the *value produced* (the size), not merely that a frame ran.
- **PlanModal (jsdom).** Render the modal, drive dictation into the listening state (the existing
  mocking pattern in `test/v2chatcomposer.test.tsx`), and assert the conversation pane carries
  `min-w-0` and that the canvas's CSS width is a percentage of its box, so it cannot exceed the pane.
  jsdom has no layout, so this is a model assertion; the geometry itself is proven by the captures.
- **Real browser.** A Vite harness renders the real Plan modal and the real weaver composer at
  devicePixelRatio 2 with a stubbed analyser, captures dark and light, and measures the meter's width
  at the first frame and after several seconds. The harness is throwaway, outside the worktree.

## Risks / Trade-offs

- **DOM shape change.** The canvas moves inside a wrapper, so `querySelector('canvas')` and any test
  asserting the canvas's own classes could change meaning. `grep` shows no existing test selects the
  canvas; the two call sites keep their class names, now on the wrapper.
- **Zero-size box.** Removing the canvas's intrinsic width means a host with no layout (jsdom) draws
  nothing; the guard skips the frame instead of throwing. Real hosts always have a box.
- **V1 pixels.** V1 passes `h-8`; the wrapper takes it, so the V1 meter keeps its height. Verify V1
  visually is out of scope but a screenshot check is cheap if time allows.
- **The production engine is unverified.** The failure was not reproducible in Chromium once the flex
  utilities applied, so the specific browser captain used is unknown. The fix does not rely on
  reproducing it: it removes the dependency on the clamp entirely, and the test encodes the feedback
  directly.
