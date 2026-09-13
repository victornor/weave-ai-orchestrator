## Context

VS-343 mounted `/v2` and registered a route and a header for every V2 destination, including
`/v2/w/$ws/knowledge`, `/v2/w/$ws/knowledge/graph` and `/v2/w/$ws/knowledge/explorer`, all three
currently `V2Page` placeholders. V1's Knowledge area (`packages/ui/src/routes/Knowledge.tsx`,
`KnowledgeDocs.tsx`, `KnowledgeExplorer.tsx`, `KnowledgeGraph.tsx`, plus `project/KnowledgeSection.tsx`)
already reads every fact through `packages/ui/src/api/hooks.ts` and keeps its pure logic in
`packages/ui/src/lib/knowledgeExplorer.ts` and `packages/ui/src/lib/graph/**`. The design reference is
committed at `docs/design/v2/`: `Screens.dc.html`'s KNOWLEDGE block (search field, four filter chips,
Knowledge bases rows with a meter, Artifacts rows, Capabilities list), `HANDOFF.md` §2 (project hue on
Knowledge rows), §4 (Knowledge is workspace-scoped), §14 (artifacts browsable in Knowledge) and §3
(shape and density).

## Goals / Non-Goals

**Goals**

- The Knowledge home at `/v2/w/$ws/knowledge`: one search over knowledge and specs, the filter chips,
  every workspace and project knowledge base as a row with its hue, meter and curation date, the spec
  capability and change pages, and artifacts linking to the reader.
- The graph and the explorer at their VS-343 routes, working with V1's behaviour, reusing V1's data
  hooks and pure graph/explorer logic.
- Reading and editing parity with V1: hub editing, revision history, revert and `curate now`.
- Frontend only; V1 at `/` untouched.

**Non-Goals**

- Any daemon, HTTP, MCP, CLI, migration or config change; any change to how knowledge is stored or
  curated.
- Building the artifact reader (VS-346) or the ticket page (VS-346); this screen only links.
- Promoting V2 to `/`, or removing V1.

## Decisions

**V2 presentation lives in `packages/ui/src/v2/knowledge/`, reusing V1's data and logic.**
`pages.tsx`'s `V2KnowledgePage`, `V2GraphPage` and `V2ExplorerPage` render the new views; the three
routes already exist. The views call the same hooks V1 calls (`useSearch`, `useKnowledgeIndex`,
`useKnowledgeDoc`, `useKnowledgeRevisions`, `useKnowledgeMutation`, `useDoc*` mutations, `useCapabilities`,
`useCapability`, `useSpecChanges`, `useSpecChange`, `useProjectArtifacts`, `useWorkspaceArtifacts`) and
the same pure logic (`lib/knowledgeExplorer.ts` for the tree; `lib/graph/model|filters|cluster|nodes`
for the graph). V1's markup is not copied; the chrome is built from the V2 classes already in
`v2.css` (`.v2-card`, `.v2-tag`, `.v2-row`, `.v2-link`) and the existing Tailwind token utilities.

**The Knowledge home follows the mockup's content and order.** `Screens.dc.html` §KNOWLEDGE lays out:
the search field, the chip row, `Knowledge bases`, `Artifacts · published by workers`, then
`Capabilities`. Real data replaces the mockup's placeholder: hubs come from `useKnowledgeIndex`, the
capability list from `useCapabilities(project)`, artifacts from `useProjectArtifacts(project)` and
`useWorkspaceArtifacts`.

**Knowledge bases: every hub, project rows in their hue.** `useKnowledgeIndex().files` already returns
one entry per hub (workspace `WORKSPACE.md`, `SHARED.md`, `decisions.md`, and each project's
`PROJECT.md`) with `tokenEstimate`, `budgetTokens`, `lastCuratedAt`, `curationPending`,
`curationDueInDays`, `projectId`/`projectSlug`. The design's single "Acme · workspace" row is a
placeholder simplification; listing every hub satisfies acceptance ("Every workspace and project
knowledge base is readable, with its meter") and hides nothing. A project hub's label uses
`projectColorVar(projectId, siblingIds)` — the same hue as the rail and everywhere else — and workspace
hubs use neutral text. Opening a row opens that base's hub viewer (below).

**Reading and editing a base reuses V1's hooks, not its markup.** The hub viewer renders the hub body
through `Markdown`, offers edit/save via `useKnowledgeMutation({op:'put'})`, lists
`useKnowledgeRevisions` with a revert per revision (`op:'revert'`), and offers `curate now`
(`op:'curate'`) — the same operations, and the same guarantee, as V1's `KnowledgeDocPanel`.

**Search is workspace-wide; the chips scope the page.** The field calls `useSearch(q)` with no project
so it covers the whole workspace (acceptance: "Search returns knowledge and spec hits for the current
workspace"). `SearchHit.kind` is `capability | requirement | change | knowledge`. With a query active
the chips filter the hits by kind (Knowledge → `knowledge`; Specs → `capability|requirement|change`);
with no query they scope the sections shown (Everything → all; Knowledge → bases; Specs → capabilities;
Artifacts → artifacts). Artifacts have no `SearchHit` kind, so the Artifacts chip always shows the
artifacts section.

**Specs use a project picker and in-page drill-downs, not new routes.** Capabilities and changes are
per project (`useCapabilities(project)`), and the mockup's header reads `Capabilities · web`. A project
picker (defaulting to the first project, mirrored to `?project=` like V1 and the board) scopes the
specs and artifacts sections. A capability opens a capability page and a change a change page inside
the same `/knowledge` route with a back control — VS-343's route table and the single highlighted rail
row stay as they are, and this mirrors how V1's `SpecsPanel` drills down.

**Artifacts link to the VS-346 reader.** Each row links to `/v2/w/$ws/artifacts/$key`, the reader
address VS-343 registered and VS-346 fills. This ticket lists and links only; if the reader cannot
resolve a key that is VS-346's concern, not a second reader here.

**The graph reuses `KnowledgeGraphView` with one theming fix.** The graph is canvas-drawn and its
chrome is thin; rebuilding it would fork logic the ticket says to reuse. `KnowledgeGraphView` already
reads its tokens with `getComputedStyle` from its own frame element, so inside `.v2-root` it picks up
V2's values — but its `MutationObserver` watches `document.documentElement`'s `data-theme`, while V2
puts `data-theme` on `.v2-root` (VS-343). `useThemeColours` is changed to observe
`el.closest('.v2-root') ?? document.documentElement`, which is a no-op for V1 (no `.v2-root` ancestor
→ documentElement) and makes the V2 graph repaint on a V2 theme switch.

**The explorer reuses the pure tree and the document viewers' data path.** Its selection and tree come
from `lib/knowledgeExplorer.ts`; its panes render `Markdown` for documents and hubs (with the same
edit/revert/curate mutations), archive files through `useKnowledgeArchiveFile`, and artifacts through
the existing `ArtifactViewer`. V2 chrome replaces V1's `ac-*` markup.

**Testing mirrors V1's existing knowledge tests.** `react-force-graph-2d` crashes in jsdom (no canvas
context), so the graph test mocks it exactly as `knowledgeGraph.test.tsx` does and asserts the routes
render and the model/logic is reached. The home test mocks `api/hooks` and asserts the KB rows, the
search hits, the chips and the spec drill-down render. The explorer test mocks the hooks and asserts
the tree and a document pane render. No browser or live daemon.

## Risks / Trade-offs

- **The artifact reader is a parallel ticket (VS-346).** Linking by `$key` assumes its reader resolves
  a published artifact by key; if it resolves differently, the link still lands on the reader route but
  shows that reader's not-found. Worth checking when VS-346 lands.
- **The graph is canvas and jsdom cannot mount it**, so its V2 route test asserts the page frame and
  that `KnowledgeGraphView` is reached, not pixels; the real visual check is the VS-354 pass.

## Migration Plan

Additive: new modules under `packages/ui/src/v2/knowledge/`, new tests, and three placeholder pages
swapped for real ones. No data or route migration. V1's knowledge routes and components are untouched
except the one `useThemeColours` observer change, which preserves V1's behaviour.
