# Diagram playbook

For architecture, request flow, and sequence-of-events content — anything where the shape between
things matters as much as the things themselves. The one rule that overrides everything else: hand-
authored inline `<svg>`, not flex/grid boxes wired together with borders. A diagram built from boxes
and CSS lines never actually looks like a diagram; it looks like a layout that broke.

## Technique

- One `<svg viewBox="0 0 W H">` per diagram, sized to its content, not the page. Pick `W`/`H` as
  round numbers (e.g. `640 240`) and lay out nodes on a mental grid — don't hand-tune pixel
  positions node by node.
- Nodes: `<rect>` with `rx` from the kit's radius scale (e.g. `rx="6"` for `--r6`), `fill="var(--bg-2)"`,
  `stroke="var(--line-2)"`. Labels: `<text>` with `fill="currentColor"`, short — 1–3 words. A node
  that needs more explanation gets a footnote below the SVG, in prose, not more text crammed inside
  the shape.
- Edges: `<line>` or a short `<path>` with `stroke="var(--line-3)"`, `stroke-width="1.5"`. An
  arrowhead is a `<marker>` defined once in a `<defs>` block and referenced by every edge via
  `marker-end` — define it once, reuse it, don't hand-draw each arrowhead separately.
- Color meaning: reserve the status tokens for actual status — a stage that's blocked gets
  `stroke="var(--status-blocked)"`, not "diagrams look nicer in color." A diagram with every box a
  different color for no reason is harder to read, not more informative.
- Cite the real thing next to what represents it: a label like `dispatcher` paired with a caption
  line `packages/core/src/runs/engine.ts:142` underneath, so the diagram can be checked against the
  repo.

## Shapes

**Flow** (left-to-right or top-to-bottom stages): nodes on one axis, edges all pointing the same
direction, at most one crossing edge. If a flow needs more than ~6 nodes to tell its story, it is
probably two diagrams, not one dense one.

**Sequence** (who does what, in order, between two or more parties): a vertical "lifeline" per
party (a `<line>` running the height of the SVG) with horizontal arrows between them at the height
each event happens. Label each arrow with the message/call, not the parties (the lifelines are
already labeled at the top).

**Tree** (a hierarchy — ownership, containment, a decision tree): root at top or left, consistent
spacing between siblings, edges as simple `<line>`s (a tree rarely needs arrowheads — direction is
implied by depth).

## Worked skeleton (three-stage flow)

```html
<svg viewBox="0 0 560 140" role="img" aria-label="Request flow: client to gateway to worker">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--line-3)" />
    </marker>
  </defs>
  <rect x="10" y="45" width="140" height="50" rx="6" fill="var(--bg-2)" stroke="var(--line-2)" />
  <text x="80" y="75" text-anchor="middle" fill="currentColor" font-size="13">client</text>

  <line x1="150" y1="70" x2="210" y2="70" stroke="var(--line-3)" stroke-width="1.5" marker-end="url(#arrow)" />

  <rect x="210" y="45" width="140" height="50" rx="6" fill="var(--bg-2)" stroke="var(--line-2)" />
  <text x="280" y="75" text-anchor="middle" fill="currentColor" font-size="13">gateway</text>

  <line x1="350" y1="70" x2="410" y2="70" stroke="var(--line-3)" stroke-width="1.5" marker-end="url(#arrow)" />

  <rect x="410" y="45" width="140" height="50" rx="6" fill="var(--bg-2)" stroke="var(--line-2)" />
  <text x="480" y="75" text-anchor="middle" fill="currentColor" font-size="13">worker</text>
</svg>
<p class="prose" style="font-size: var(--fs-meta); color: var(--text-2);">
  gateway: packages/server/src/app.ts:70
</p>
```
