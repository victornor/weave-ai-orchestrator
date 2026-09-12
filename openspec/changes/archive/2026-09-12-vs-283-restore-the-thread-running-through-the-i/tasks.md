# Tasks

## 1. Retrace the mark with the tails kept

- [x] 1.1 Generate the trace from the source raster with `magick <src> -crop 1200x1200+424+415 +repage -alpha extract -threshold 50% -morphology Dilate Disk:12 -negate | potrace -s`, and verify the alpha bounding box is `1861x414+93+808` before cropping. Crop kept from the ticket; dilate raised from the suggested `Disk:6` to `Disk:12` because `Disk:6` rendered too faint at 16px, and all three crossing gaps stayed open.
- [x] 1.2 Verify the trace is a single clean white path with open, un-welded gaps at all three crossings and no fringing artefacts, by rendering it at 256px on `#5E6AD2`.

## 2. Ship `icon.svg`

- [x] 2.1 Write the traced path into `packages/ui/public/icon.svg` with a square `64` viewBox, full-bleed `#5E6AD2` rect with `rx="288"`, white path, and a provenance comment naming the exact regeneration command.
- [x] 2.2 Render `icon.svg` at 256px and confirm the thread reaches both left and right edges and the knot is visibly larger than the current `main` artwork.

## 3. Ship `icon-maskable.svg`

- [x] 3.1 Write the same traced path into `packages/ui/public/icon-maskable.svg` in a larger square viewBox scaled so the whole mark, tail tips included, sits inside the circular safe area; keep the rect square, no `rx`, and update the provenance comment.
- [x] 3.2 Render `icon-maskable.svg` composited under a circular mask and confirm no part of the mark touches the crop edge.

## 4. Verify consumers and the 16px result

- [x] 4.1 Confirm every reference still resolves and filenames are unchanged (`grep -R "icon\\(-maskable\\)\\?.svg" packages/ui/index.html packages/ui/public/manifest.webmanifest packages/ui/public/sw.js`).
- [x] 4.2 Render both icons at 16px and attach 16px + 256px renders plus the source beside the result; confirm 16px reads as a woven band with visible texture (accepted) and that no tail was cropped to improve it.
- [x] 4.3 Confirm the source raster is not staged/committed (`git status` lists only the two SVGs).

## 5. Green checks

- [x] 5.1 `pnpm lint`, `pnpm typecheck` and both test suites green, pasting both suite blocks verbatim in the report.
