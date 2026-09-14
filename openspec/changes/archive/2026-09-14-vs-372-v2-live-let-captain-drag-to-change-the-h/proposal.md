# V2 Live: a draggable shared tile height

Tracker change for [VS-372](weave://tickets/VS-372). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

The V2 Live floor lets captain choose how many tiles sit per row, but every tile's feed height is
fixed by the column ladder (420 / 300 / 240 / 200px). Captain wants to expand them vertically too:
one drag sets one shared height for every tile. This is the height axis of the same per-device
preference the per-row control already writes.

## What changes

- A grid-level resize grip on Live's desktop layout (`packages/ui/src/v2/LivePage.tsx`): drag the
  grip, or focus it and press the up/down arrows, to set one height shared by every tile;
  double-click returns to the per-row default. The height is clamped between a minimum that still
  shows a few trace lines and most of the viewport.
- The chosen height is remembered on the device beside the per-row count
  (`packages/ui/src/v2/prefs.ts`). It survives reloads, and changing the per-row count keeps it
  while the per-row ladder remains the default until captain drags.
- The feed inside a tile fills that height and scrolls inside the tile
  (`packages/ui/src/v2/WorkerFeed.tsx`, `packages/ui/src/components/RunTranscript.tsx`), so the
  card's header, ticket line and dropped-stream notice are never clipped.

## Out of scope

Phone Live stays a single-column list at its natural height, with no grip. The per-row ladder is
unchanged as the default. VS-366's page-level scroll fix is untouched.
