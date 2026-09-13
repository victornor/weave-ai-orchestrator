## Why

V2 (VS-343) ships the `/v2` shell, the Mono theme, the rail and an empty page for every destination.
The workspace `Knowledge` destination, and the kept knowledge graph and explorer routes, still render
the VS-343 placeholder. V1's Knowledge area — one search over knowledge and specs, the hub files with
their budget meters, linked documents, the capability and change pages, artifacts, and the graph and
explorer — is the only way to read what the system knows. Until it is restyled onto V2, the redesign
is missing a whole section and the V2 rail's Knowledge row leads nowhere.

## What Changes

- **The Knowledge home at `/v2/w/$ws/knowledge`.** One search box over knowledge and specs for the
  current workspace, with kind filters (Everything · Knowledge · Specs · Artifacts); workspace and
  project knowledge bases as rows carrying the project's hue, a size/budget meter and the last-curated
  date; the spec capability list; and artifacts published by workers. Each row is one bordered-line
  row in the Mono density, not a pill, per HANDOFF §2–§3.
- **Knowledge bases are readable with reading/editing parity.** Opening a base shows its hub with its
  revision history, revert and `curate now`, reusing V1's hooks.
- **Specs.** The capability list, a capability page (requirements, inline pending deltas, change
  history) and a change page (tasks, proposal, design, deltas), restyled from V1's `SpecsPanel`.
- **Artifacts are browsable** from the home and link to the V2 artifact reader route; the reader
  itself is the Work ticket's.
- **The graph and the explorer at their VS-343 routes**, restyled from V1's `KnowledgeGraph`,
  `KnowledgeExplorer` and `KnowledgeDocs` onto V2 primitives, reusing V1's data hooks and graph logic
  (`lib/graph/**`, `lib/knowledgeExplorer.ts`) rather than rewriting them.
- **Frontend only.** No daemon, API, migration or config change; V1 at `/` is untouched and its tests
  keep passing.

## Capabilities

### New Capabilities

- `web-v2/knowledge`: the workspace-scoped Knowledge home — the cross-knowledge-and-specs search and
  its kind filters, the knowledge-base rows with their meters, reading/editing a base, the spec
  capability and change pages, and the browsable artifacts list.
- `web-v2/knowledge-views`: the kept graph and explorer views in V2 — the graph's model, filters,
  dragging, zooming and node opening, and the explorer's folder tree and inline document, hub, archive
  and artifact panes, all with V1's behaviour.

### Modified Capabilities

_None. V2 is additive and V1's specified behaviour is unchanged._

## Impact

- **New:** `packages/ui/src/v2/knowledge/**` — the Knowledge home, its search, knowledge-base,
  spec and artifact sections, and the restyled graph and explorer views. New UI tests under
  `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` — `V2KnowledgePage`, `V2GraphPage` and
  `V2ExplorerPage` stop being placeholders and render the new views. No `router.tsx` change: the
  three routes already exist from VS-343.
- **Reused, not forked:** `packages/ui/src/api/hooks.ts` (`useSearch`, `useKnowledgeIndex`,
  `useKnowledgeDoc*`, `useKnowledgeMutation`, `useKnowledgeRevisions`, `useCapabilities`,
  `useCapability`, `useSpecChanges`, `useSpecChange`, `useProjectArtifacts`, `useWorkspaceArtifacts`),
  `packages/ui/src/lib/graph/**`, `packages/ui/src/lib/knowledgeExplorer.ts`, and
  `packages/ui/src/components/ArtifactViewer.tsx`.
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
