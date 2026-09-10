## Context

See proposal.md for motivation. The live graph is `packages/ui/src/routes/KnowledgeGraph.tsx`
plus `packages/ui/src/lib/graph/{simulation,viewport,model,filters,hull}.ts` (VS-64).
Wheel, pinch, pan, Fit and Reset already work. Opening sets `autoFitRef = true` and
every simulation tick calls `fitTo(bounds, size)`, so a workspace-scale graph paints
at `k` below `LABEL_TRUNCATED_ZOOM` (0.6) and document titles vanish. Nodes are filled
circles (`r = 6 + degree`) / rotated squares with `fontSize={11}` under the node.

The simulation already lays out in roughly screen coordinates (`forceX/Y` at
`size/2`). Fit-on-open is what shrinks that layout; spreading forces without
changing the default viewport would just zoom out further.

## Goals / Non-Goals

**Goals:**

- First paint is readable: titles visible, chips not overlapping.
- Explicit zoom in/out next to Fit/Reset; wheel and pinch unchanged.
- Node chrome matches `Button` / `Chips` / `ac-card` (tokens, type, border), not
  a d3 blob.
- Existing drag, pin, search, filters, hulls, phone list, reduced motion stay.

**Non-Goals:**

- No new graph library, no canvas/WebGL renderer, no HTML overlay / `foreignObject`.
- No change to `GET /knowledge/graph` or to which hubs/docs appear.
- Not Telegram / TUI. Not a new knowledge route.

## Decisions

### Stop auto-fitting on open; floor the default zoom

Replace the per-tick `fitTo` while `autoFitRef` is true with a **readable default**:

```
k = max(fitTo(bounds, size).k, DEFAULT_ZOOM)   // DEFAULT_ZOOM = 1
centre the bounds in the frame at that k
```

`DEFAULT_ZOOM = 1` is `IDENTITY.k` and sits in `truncated` label detail
(`LABEL_TRUNCATED_ZOOM = 0.6`, `LABEL_FULL_ZOOM = 1.4`), so document titles show
at first paint. A small graph that already fits at `k > 1` still uses the fitted
scale (nodes are not forced smaller). A large graph stays at `k = 1` and spills
off-canvas; Fit is how you see everything.

Auto-apply this default on each tick until the reader first pans, zooms, fits,
resets or focuses — same latch as today's `autoFitRef`, different transform.
Reset returns to this default (centred, floored), not to `{k:1,x:0,y:0}` which
can leave a drifted layout off-centre.

*Alternatives considered.* Keep fit-on-open but enlarge `nodeRadius`: fit still
scales the whole scene down, so blobs stay small on a large graph. Rejected.
Always start at `IDENTITY` without recentring: the simulation centre is the
frame, but a refetch or filter can drift it. Rejected in favour of recentring.

### Zoom buttons are `zoomAround` the frame centre

Two `Button size="sm"` controls, labelled Zoom in / Zoom out, next to Fit and
Reset. Each applies `zoomAround(view, frameCentre, 1.25)` or `1/1.25`, then
clears the auto-default latch. Wheel and pinch keep pointer-anchored zoom.
No new dependency (`d3-zoom` stays out — same reason as VS-64).

### Spread the force layout to match chip size

Chips need a collide radius on the order of 40–56 graph units, not 6–20.

| Force | Today | This change |
|---|---|---|
| `linkDistance` | `54 + r_s + r_t` | `120 + r_s + r_t` |
| `forceCollide` padding | `r + 8` | `r + 16` |
| `forceManyBody` | `-240` | `-420` |
| `clusterForce` | `0.2` | `0.08` |

`nodeRadius` becomes half the chip height (hubs taller / wider than documents,
still growing with `degree`). Cluster hulls stay; weaker clustering still
groups a project without collapsing it.

The existing "linked closer than unlinked" simulation test still holds if
distances scale up together.

### Nodes are SVG chips, not circles

Keep drawing in SVG (jsdom tests, no `foreignObject` hit-testing). Each node:

- Rounded rect (`rx` from `--radius-4`), fill `var(--bg-1)`, stroke `var(--line-2)`.
- Group colour as a left accent bar (same language as project chips), not the fill.
- Title as SVG `text` with `text-micro` / `text-text-1`; hubs `font-semibold`.
- Selected: stroke `var(--text-1)` (same as today). Pinned: existing pin dot.
- Dimmed: opacity, unchanged.

Title lives *in* the chip, so it scales with the view. Drop the inverse
`scale(1/k)` counter-scale on labels — that was for 11px captions under tiny
circles. Label-detail thresholds stay; far-out still hides document titles.

Hub vs document: hub chip is taller and `font-semibold`; document is the
compact chip. Degree still grows width/height slightly so landmarks read larger.

*Alternatives considered.* HTML overlay nodes: real Tailwind, but pointer
routing fights the SVG scene and jsdom tests get harder. Rejected. Keep circles
and only enlarge them: still a blob aesthetic, which the ticket forbids.

### Tests

- `graphViewport.test.tsx`: `defaultView` floors `k` at `DEFAULT_ZOOM` for a
  large bounds and uses fitted `k` when that is already higher.
- `knowledgeGraph.test.tsx`: first paint `scale(...)` is ≥ `DEFAULT_ZOOM`;
  Zoom in / Zoom out change `k`; a node is a labeled rect (not only a `circle`);
  default view shows a document title (not hubs-only).
- `graphSimulation.test.tsx`: after settle, min neighbour gap is greater than
  the chip collide radius (no overlap). Existing linked-closer test kept.

jsdom still has no layout: keep faking geometry the way `web-app-testing`
describes. `touch-action` stays asserted via `touch-none`, not `toHaveStyle`.

## Risks / Trade-offs

- [Large graphs clip at first paint] → Intended. Fit still frames everything.
  Caption already shows page/link counts so the clip is not silent.
- [Weaker clustering makes hulls messier] → Hull pad can rise slightly (`HULL_PAD`
  30 → 40) if tests show concave overlap; grouping is still the cluster force,
  just gentler.
- [SVG text + Tailwind type] → `text-micro` is a utility; if SVG ignores it,
  set `font-size` from the same `--fs-micro` token. No raw `px` in new node
  chrome (lint gate).
- [Existing tests assume `circle` / inverse label scale] → Update those
  assertions in the same change; they encode the blob look.

## Migration Plan

None. UI rebuild. Rollback is revert. No data, no API.

## Open Questions

None.
