# Tasks

- [x] 1. Hand-author the knot mark as vector paths in `packages/ui/public/icon.svg` (64×64 viewBox, `#5E6AD2` ground, `#ffffff` strand), with the tails trimmed to stubs and cropped square, and a clean gap at every over-under crossing.
- [x] 2. Give `packages/ui/public/icon-maskable.svg` its own knot geometry, scaled down for the circular mask safe area, not the same artwork at the same scale.
- [x] 3. Verify every reference to either file still resolves (grep `packages/ui/index.html`, `packages/ui/public/manifest.webmanifest`, `packages/ui/public/sw.js`).
- [x] 4. Render both icons at 16×16 and check by eye that the mark reads as a knot rather than a smudge; simplify if it does not.
- [x] 5. Confirm the maskable variant survives a circular crop with no part of the mark touching the crop edge, and that the source raster is not committed.
- [x] 6. `pnpm lint`, `pnpm typecheck` and both test suites green.
