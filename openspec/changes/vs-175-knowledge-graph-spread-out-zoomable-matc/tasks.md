## 1. Default viewport and zoom controls

- [x] 1.1 Add `DEFAULT_ZOOM` and `defaultView(bounds, size)` in
      `packages/ui/src/lib/graph/viewport.ts`: `k = max(fitTo(...).k, DEFAULT_ZOOM)`
      centred on the bounds. Verify `graphViewport.test.tsx` covers a large bounds
      flooring at `DEFAULT_ZOOM` and a small bounds keeping the higher fitted `k`.

- [x] 1.2 In `KnowledgeGraph.tsx`, stop per-tick `fitTo` on open. Auto-apply
      `defaultView` until the reader pans, zooms, fits, resets or focuses. Reset
      returns to `defaultView`, not `IDENTITY`. Add Zoom in / Zoom out buttons
      (`Button size="sm"`) that `zoomAround` the frame centre by 1.25. Verify
      `knowledgeGraph.test.tsx`: first-paint scale ≥ `DEFAULT_ZOOM`, Zoom in
      increases `k`, Zoom out decreases `k`, Reset lands on the readable default.

## 2. Spread-out layout

- [x] 2.1 In `packages/ui/src/lib/graph/simulation.ts`, raise `linkDistance` to
      `120 + r_s + r_t`, collide padding to `r + 16`, many-body to `-420`,
      cluster strength to `0.08`, and size `nodeRadius` for chip collide
      (hubs larger than documents, still growing with degree). Verify
      `graphSimulation.test.tsx`: linked nodes stay closer than unlinked, and
      after settle the minimum neighbour gap exceeds the collide radius.

## 3. Chip chrome

- [x] 3.1 Replace `GraphNodeShape` circles/diamonds with labeled SVG chips:
      rounded rect, `var(--bg-1)` / `var(--line-2)`, group colour as a left
      accent, title in `text-micro` / `text-text-1` (hubs `font-semibold`),
      selected and pinned markers unchanged. Drop inverse `scale(1/k)` label
      counter-scale. Verify `knowledgeGraph.test.tsx`: a document title is
      visible at first paint, hubs remain distinguishable, far-out zoom still
      hides document titles, and nodes are not unmarked filled circles.

## 4. Checks

- [x] 4.1 Run `pnpm lint && pnpm typecheck && pnpm --filter @agent-conductor/ui exec vitest run`
      and confirm all are green.
