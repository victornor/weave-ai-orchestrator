## 1. Render the chosen height as a cap

- [x] 1.1 In `packages/ui/src/routes/Chat.tsx`, replace the resized branch's
      `{ height: '${decisionHeight}px', maxHeight: 'calc(var(--ac-app-h) * 0.75)' }` with a style that
      drops the fixed `height` and caps with `maxHeight: 'min(${decisionHeight}px, calc(var(--ac-app-h) * 0.75))'`
      instead, per design.md. Verify by reading the diff: no code path still writes an unconditional
      pixel `height` once a height is chosen.

## 2. Update the resize test suite for the new styling

- [x] 2.1 In `packages/ui/src/test/chat.test.tsx`'s `ChatRoute resizable decisions area` suite, change
      every assertion of the form `area().style.height).toBe('${n}px')` for a chosen height to assert
      `area().style.maxHeight` reflects a cap of `n` (e.g. contains `min(${n}px, `) instead, and that
      `area().style.height` stays `''`. Verify with `pnpm --filter @agent-conductor/ui exec vitest run
      chat.test.tsx` passing.
- [x] 2.2 Add a test for the all-hidden case: with a stored height chosen for a screenful of cards,
      hide every open decision and assert the area's `maxHeight` still caps at the chosen height (not
      that the area is forced to it) — i.e. the style no longer forces a fixed height, satisfying
      acceptance criterion 1. Verify the new test passes.
- [x] 2.3 Add a test for content shorter than the stored height (e.g. one short card open, with a
      large stored height) asserting the same styling (`maxHeight` caps, no fixed `height`) applies
      regardless of how much content is open. Verify the new test passes.
- [x] 2.4 Add or extend a test covering acceptance criterion 5: re-showing every hidden decision while
      a height is chosen results in the same capped styling with the cards back in the DOM (no
      residual state suppressing them). Verify the new test passes.
- [x] 2.5 Confirm the existing drag, clamp (`stops at the large/small end`), persistence
      (`opens at the height this device chose`), reset, and keyboard-step tests still pass after
      being updated for the new style shape, and that acceptance criterion 4 (nothing pinned → area
      not rendered) is still covered by an existing, unchanged test. Verify with the full
      `chat.test.tsx` run green.

## 3. Verify the full change

- [x] 3.1 Run `pnpm typecheck && pnpm lint && pnpm test` from the repo root and confirm all are green.
