# Tasks

- [x] 1. Compact the geometry: `BAR.height` and `--bar-height` drop to 56px now that nothing is sunk into the bar, and the thumb-target test runs against the new number.
- [x] 2. Make `--bar-inset` the one number the content reserves — `--bar-height` plus `--bar-handle` as the two chrome heights, `.ac-bar-pad` reading the inset, `data-bar` on the shell choosing between them.
- [x] 3. `lib/barVisibility.ts`: the hidden choice remembered per device, guarded like `wsExpansion.ts`.
- [x] 4. `BottomBar` grows the fold: a nub straddling the bar's top-left edge, and a full-width handle with a grab mark that comes back on a tap or a swipe up past the threshold.
- [x] 5. `AppShell` owns the preference, seeds it from the device and publishes `data-bar`.
- [x] 6. Stand the bar, the handle and the inset down while `data-keyboard` is open, in CSS alone.
- [x] 7. Tests: the new geometry, the hide control, the handle's tap and swipe, the persistence round-trip and the shell's `data-bar` wiring.
- [x] 8. `DESIGN-CONTRACT.md` §3 carries the new layout rule and the fold.
- [x] 9. Verify in Chromium at 360px and 390px — bar shown, bar hidden, keyboard open — and put the screenshots on the PR.
