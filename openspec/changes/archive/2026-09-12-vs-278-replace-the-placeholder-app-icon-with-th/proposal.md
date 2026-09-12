# Replace the placeholder app icon with the chosen weave knot mark

Tracker change for [VS-278](conductor://tickets/VS-278). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Both shipped icons (`packages/ui/public/icon.svg`, `packages/ui/public/icon-maskable.svg`) are still
a placeholder: a white diamond on the `#5E6AD2` accent square. Captain has chosen the product mark —
a monoline knot: a single strand entering from the left, looping through three over-under crossings,
and exiting right. The chosen image is a raster (2048×2048, white strokes on transparent) with
coloured edge fringing, so it cannot be dropped in: at favicon size the fringing reads as dirt.

## What changes

- Redraw the mark as hand-authored vector paths in both icon files: `#5E6AD2` ground, `#ffffff`
  strand, no embedded raster and no auto-trace artefacts.
- Trim the long entry/exit tails to short stubs and crop square around the knot, since the maskable
  and favicon slots are square and the tails are the first thing lost at 16px.
- Give `icon-maskable.svg` its own geometry, scaled down for the circular mask safe area, instead of
  shipping the same artwork at the same scale.
- Keep every existing reference resolving (`packages/ui/index.html` favicon,
  `packages/ui/public/manifest.webmanifest`, `packages/ui/public/sw.js`).
- Do not commit the source raster.

## Non-goals

- A wordmark or lockup pairing the mark with the word "weave".
- Any other surface (login page, sidebar, docs headers).
- The `--accent` token itself.

## Verification

- Stroke weight uniform; each over-under crossing is a clean gap in the strand passing underneath.
- Rendered at 16×16 the mark still reads as a knot, checked by eye.
- The maskable variant survives a circular crop with no part of the mark touching the crop edge.
- `pnpm lint`, `pnpm typecheck` and both suites green.
