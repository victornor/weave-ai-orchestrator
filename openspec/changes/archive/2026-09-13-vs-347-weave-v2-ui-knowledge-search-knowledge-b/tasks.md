## 1. The Knowledge home scaffold

- [x] 1.1 Create `packages/ui/src/v2/knowledge/` and a `KnowledgeHome` view that renders inside the
  V2 page frame `V2Page title="Knowledge"`; make `V2KnowledgePage` in `v2/pages.tsx` render it instead
  of the placeholder. Keep the route and its header unchanged.
- [x] 1.2 Give the view the mockup's content order from `Screens.dc.html` §KNOWLEDGE: the search field,
  the filter chips, then the `Knowledge bases`, `Artifacts` and `Capabilities` sections. Use the V2
  classes already in `v2.css` (`.v2-card`, `.v2-tag`, `.v2-row`, `.v2-link`); 4–6px corners, no pills.

## 2. Search across knowledge and specs, with kind filters

- [x] 2.1 Add the search field calling `useSearch(q)` with no project, so it covers the whole
  workspace, and render the hits with their kind and title.
- [x] 2.2 Add the four chips — Everything · Knowledge · Specs · Artifacts — and make them filter the
  hits by kind while a query is active (`Knowledge` → `knowledge`; `Specs` →
  `capability|requirement|change`) and scope the sections shown when there is no query.
- [x] 2.3 Show an empty result state that names what was searched, so a miss is not a blank page.

## 3. Every knowledge base as a row, readable and editable

- [x] 3.1 List every hub from `useKnowledgeIndex()` (workspace `WORKSPACE.md`, `SHARED.md`,
  `decisions.md`, and each project's `PROJECT.md`) as a row with its size/budget meter and its
  last-curated date, or that curation is due.
- [x] 3.2 Label a project hub in its project's hue using `projectColorVar`, the same hue it carries in
  the rail and elsewhere; leave workspace hubs neutral.
- [x] 3.3 Opening a row shows the hub body through `Markdown`, with edit/save (`op:'put'`), the
  revision history from `useKnowledgeRevisions` with a revert per revision (`op:'revert'`), and
  `curate now` (`op:'curate'`).

## 4. Specs: the capability list, capability pages and change pages

- [x] 4.1 Add a project picker (defaulting to the first project, mirrored to `?project=`) that scopes
  the specs and artifacts sections.
- [x] 4.2 List the project's capabilities from `useCapabilities(project)` with their requirement counts
  and any pending change.
- [x] 4.3 Open a capability page (`useCapability`) showing its requirements, any inline pending delta
  and its change history, with a back control on the same route.
- [x] 4.4 Open a change page (`useSpecChange`) showing its tasks, proposal, design and deltas, reachable
  from a capability's history and from the change list, with a back control.

## 5. Artifacts browsable and linked to the reader

- [x] 5.1 List the project's published artifacts from `useProjectArtifacts(project)` and the
  workspace's from `useWorkspaceArtifacts`, with title, ticket and time.
- [x] 5.2 Link each row to `/v2/w/$ws/artifacts/$key`, the reader address VS-343 registered (the reader
  itself is VS-346's). Do not build a second reader.

## 6. The knowledge graph in V2

- [x] 6.1 Make `V2GraphPage` render `KnowledgeGraphView` (lazy, as V1 loads it) inside the V2 page
  frame, passing the workspace scope's project filter, and wire its `onOpen` to open the document or
  hub.
- [x] 6.2 Change `useThemeColours` in `routes/KnowledgeGraph.tsx` to observe
  `el.closest('.v2-root') ?? document.documentElement` for its `data-theme` mutation, so the V2 graph
  repaints when the V2 theme switches; confirm V1 is unchanged (no `.v2-root` ancestor).
- [x] 6.3 Confirm the graph keeps V1's model, filters, drag/zoom/pan/search and node opening by
  reusing `lib/graph/**` unchanged.

## 7. The knowledge explorer in V2

- [x] 7.1 Make `V2ExplorerPage` render a `KnowledgeExplorerView` built from
  `lib/knowledgeExplorer.ts`'s tree and the same hooks V1's explorer uses (`useKnowledgeDocs`,
  `useKnowledgeIndex`, `useProjectArtifacts`, `useWorkspaceArtifacts`, archive hooks), with V2 chrome.
- [x] 7.2 Render a selected document or hub inline through `Markdown`, with hub edit/revert/curate;
  render an archive file and an artifact through `useKnowledgeArchiveFile` and the existing
  `ArtifactViewer`. Keep the phone single-pane behaviour.

## 8. Tests and verification

- [x] 8.1 Add a Knowledge home test: the KB rows render with their meters, a search returns knowledge
  and spec hits, the chips narrow them, and a capability opens its page. Mock `api/hooks`.
- [x] 8.2 Add a graph route test that mocks `react-force-graph-2d` as `knowledgeGraph.test.tsx` does
  and asserts `/v2/w/<ws>/knowledge/graph` renders the V2 graph frame with V1's data wired in.
- [x] 8.3 Add an explorer route test that mocks the hooks and asserts `/v2/w/<ws>/knowledge/explorer`
  renders the tree and a selected document pane.
- [x] 8.4 Confirm no HTTP route, MCP tool, CLI command, migration or daemon file changed, and that V1's
  existing knowledge tests still pass unchanged.
- [x] 8.5 Run `pnpm lint` and `pnpm typecheck`; both clean. Run `pnpm test` and
  `pnpm --filter @weave-ai/ui exec vitest run` separately and paste both suite blocks verbatim in the
  report.
- [x] 8.6 Run `openspec validate vs-347-weave-v2-ui-knowledge-search-knowledge-b --json --strict` and
  confirm it is clean.
