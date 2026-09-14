# A V2 Work card's tags share one casing

Tracker change for [VS-400](weave://tickets/VS-400). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

On a V2 Work card (`packages/ui/src/v2/work/Work.tsx`), one tag row mixes two casing conventions.
The kind tag (`task`/`change`) and the `needs you` marker are plain `<span className="v2-tag">`
elements, and `.v2-tag` in `packages/ui/src/v2/v2.css` carries no `text-transform` — so they read
lowercase. The worker-model tier tag goes through `WorkerModelTag` → `Badge`
(`packages/ui/src/components/StatusGlyph.tsx`), which hardcodes `uppercase` — so it reads
`DEFAULT`/`THOROUGH`. A card with a tier tag therefore shows `task` and `needs you` beside
`DEFAULT`.

The design reference (`docs/design/v2/Screens.dc.html`) renders the Work card's kind and tier through
`CHIP` (`text-transform:uppercase`, grey border) and its state tag through already-uppercase data,
so the whole tag row is uppercase; the sibling table view in V2 already renders kind and tier through
`Badge`, also uppercase. The card is the only place that drifts.

## What changes

- **The V2 Work card's kind, tier, `needs you` and `spec archive pending` tags render uppercase**, so
  the whole row shares one casing. Applied with the existing `uppercase` utility on the `.v2-tag`
  spans, the same mechanism `Badge` uses.
- **The tier tag is rendered through the `.v2-tag` recipe** (its neighbours' recipe) using the
  existing `workerModelTagLabel` gate, not through `Badge`. `Badge` is untouched, so V1 and every
  other consumer of `WorkerModelTag` keep their current rendering.
- **A regression test** in `packages/ui/src/test/v2work.test.tsx` holds a card whose tier, kind and
  `needs you` are all present to exactly one casing class.

## Out of scope

`Badge` is not changed globally, and no other V2 screen's tag casing is touched. The design's kind
chip is 9px with letter-spacing; this change is about casing consistency, not the full chip recipe.
