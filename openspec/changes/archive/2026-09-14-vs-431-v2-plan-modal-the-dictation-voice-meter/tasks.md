## 1. Make the voice meter layout-stable

- [x] 1.1 In `packages/ui/src/components/VoiceMeter.tsx`, render a wrapper element that takes the
  caller's `className` (the sizing box) and put the canvas inside it with an explicit CSS size
  (`display:block`, `width:100%`, `height:100%`), so the canvas's `width`/`height` attributes cannot
  drive layout.
- [x] 1.2 Measure the wrapper's client box in the rAF frame (guarding against zero) and set the
  backing store from it; never read the canvas's own `clientWidth`/`clientHeight`. Keep the waveform
  geometry, timing, `--accent` read and fallback exactly as they are.
- [x] 1.3 Confirm the V1 call site (`packages/ui/src/components/Composer.tsx`) and the V2 call site
  (`packages/ui/src/v2/ChatComposer.tsx`) render unchanged, with the meter's box and height the same
  as before.

## 2. Constrain the Plan modal panes

- [x] 2.1 Add `min-w-0` to the Plan modal's conversation pane (`section` in
  `packages/ui/src/v2/PlanModal.tsx`) and to its flex parent row, so no child can widen the pane or
  the surface.

## 3. Tests

- [x] 3.1 Add a `VoiceMeter` test that fakes `requestAnimationFrame` and `devicePixelRatio = 2`,
  makes the canvas's measured layout width grow while the wrapper's stays fixed, runs several frames,
  and asserts the backing width stays constant (`wrapperWidth * 2`).
- [x] 3.2 Add a Plan modal test that drives the composer into its listening state and asserts the
  conversation pane is width-constrained (`min-w-0`) and the meter's CSS width cannot exceed its box.

## 4. Real-browser evidence

- [x] 4.1 Render the real Plan modal and the real weaver chat composer in a throwaway Vite harness at
  devicePixelRatio 2 with dictation listening (stubbed analyser); capture dark and light, and record
  the meter's width at the first frame and after several seconds in both hosts. Widths must match.

## 5. Checks and delivery

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck` and both suites (`pnpm test` — core/server and UI blocks
  pasted verbatim in the PR).
- [x] 5.2 Open the PR against `main` with the captures and the width measurements, and request
  review.
