## Why

captain asked for a file browser and described it precisely: VS Code. Tree on the left, the selected
file's content filling the rest, roughly one fifth to four fifths. What shipped (VS-265) is a centred
896px single column (`KnowledgeExplorer.tsx:84`, `mx-auto max-w-4xl`): on a wide display most of the
page is empty, and the tree is a list whose document content appears below it rather than beside it.
That is a file list, not a file browser. This change turns the existing explorer into the two-pane
surface captain asked for, without moving where documents live or how artifacts behave.

## What Changes

- Rebuild the explorer's frame as a two-pane layout that fills the page: a tree pane on the left
  (roughly one fifth) and a content pane on the right (roughly four fifths), both scrolling
  independently, with a draggable divider clamped to a sensible range.
- Render the selected entry's content inline in the right pane using the viewers that already exist
  (`DocPanel` for linked documents, `KnowledgeDocPanel` for hub files, the existing archive and
  artifact panels) — no second markdown renderer, no navigation away from the explorer.
- Default the content pane to the project's `PROJECT.md` so arriving at the explorer never shows an
  empty page.
- On a narrow viewport (below the `md` breakpoint, i.e. 390px phones) show one pane at a time: the
  tree until something is selected, then the content with a way back to the tree. No squashed panes.
- Reflect the selected document in the explorer's URL (`?tab=explorer&project=…&doc=<scope>:<slug>`)
  so a link opens the explorer with that document already selected. `?project=` and `?tab=` are read
  already; `?doc=` is the only new parameter.
- Keep the Artifacts entry and its sandboxed `ArtifactViewer` iframe exactly as they behave today,
  only repositioned into the content pane.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `knowledge/document-explorer`: the browsing surface gains a persistent content pane, a default
  `PROJECT.md` selection, independent pane scrolling, one-pane-at-a-time behaviour on narrow
  viewports, and URL-addressable document selection. The existing "Opening a tree entry shows its
  content" requirement is amended from "open the detail view (which currently renders below the
  tree)" to "render the content in the explorer's content pane", and the tree/content layout is
  stated as requirements rather than left to the implementation.

## Impact

- `packages/ui/src/routes/KnowledgeExplorer.tsx`: the layout frame, selection state, content pane,
  mobile single-pane behaviour, and URL sync. The tree rows, archive row and artifact section are
  reused; only the frame and where their detail panels render changes.
- `packages/ui/src/lib/knowledgeExplorer.ts`: small pure helpers to parse/serialize the `doc` URL
  parameter (testable independently of the component).
- `packages/ui/src/routes/KnowledgeDocs.tsx`: reused unchanged (`DocPanel`, `KnowledgeDocPanel`); no
  second document renderer is added.
- `packages/ui/src/test/knowledgeExplorer.test.tsx`: new coverage for the two-pane frame, default
  selection, in-place document swapping, mobile pane switching and the URL parameter; the existing
  tests are updated for the new DOM, not deleted.
- No server, API, CLI or DB change. No route change beyond the existing search passthrough already
  accepting arbitrary `?doc=`.
