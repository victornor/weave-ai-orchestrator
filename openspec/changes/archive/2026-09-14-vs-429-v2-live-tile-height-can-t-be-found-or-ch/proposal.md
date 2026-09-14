# All Live tiles resize together from a corner grip

Tracker change for [VS-429](conductor://tickets/VS-429). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Captain cannot change the height of the tiles on the V2 Live floor, only the number per row:

> We should have a little drag in the corner, just like the other places, where you can adjust the
> height of the live view, and it should apply to all of the live views on the page.

VS-372's shared-height control is a `role="separator"` bar eight pixels tall that sits *above* the
grid and renders as a thin line on the page background. It is functional and effectively invisible:
captain has never found it. Every other resizable pane in V2 (Watch, Roles, a decision's Watch) uses
VS-409's corner grip, so that is the affordance the floor should show too.

## What changes

- **The corner grip is reused, not reimplemented.** `WorkerFeed`'s private `PaneResizeGrip` becomes an
  exported `ResizeGrip` whose range, step and label the caller supplies, so the same drag, arrow-key
  and double-click behaviour drives a trace pane and a Live tile. Its drag handles call back through
  refs, so a parent that passes a fresh callback on every render does not churn its listeners.
- **A grip in the bottom-right of every tile.** `LiveCard` becomes positioned and renders the grip
  over the feed's last line. `bodyHeight` already carries the one shared height to every tile, so a
  drag on any tile's grip moves them all in step.
- **The bar is gone.** The eight-pixel separator above the grid, and the `LiveBody` pointer and
  keyboard handlers behind it, are deleted. The grip is the only resize affordance.
- **The height is still one preference.** `customHeight` stays the source of truth, clamped by
  `clampLiveHeight`, written to `weave.v2.live.height` when a drag is released, on an arrow step and
  on a double-click reset (which clears it so the per-row ladder applies again). Per-row count and
  the phone layout — one column, no fixed height, no grip — are unchanged.
