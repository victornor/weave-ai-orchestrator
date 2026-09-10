## Why

Captain, 2026-09-10: on the knowledge graph, Shared conventions, Decision log,
and a Workspace node are always empty even on mature projects, and unconnected
to everything. Unclear what they are for or when they populate.

Those three are workspace-level hubs. `GET /knowledge/graph` emits one node per
`knowledge_files` row, including seed skeletons, and only draws edges from
resolved `[[wiki]]` links. Hub files almost never wiki-link, so SHARED.md,
decisions.md and WORKSPACE.md land as disconnected dummy chips — even when
SHARED.md already has dated convention notes.

## What Changes

- A hub file that is still a stub (skeleton headings / comments / fill-in
  hints, no section entries and no resolved wiki-links) is **omitted** from
  the graph. A stub-only decision log no longer appears as an empty
  unconnected node.
- A hub that has section entries stays as one node. Selecting it still opens
  that hub file. Entries are **not** exploded into per-bullet nodes.
- On the unscoped ("all") graph, when both endpoints are present, add
  **honest structural edges**: workspace hub → shared hub, workspace hub →
  decisions hub. Never invent shared/decisions → project edges.
- The per-project graph (`?project=`) is that project's hub and documents
  only. Workspace-scoped hubs are not injected there.
- If the workspace hub itself is a stub but shared or decisions is populated,
  the workspace hub is still included as the parent those structural edges
  need.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `knowledge/graph-exploration`: workspace hub files appear only when they
  have content (or are needed as a parent), with honest workspace-scope
  edges; stub hubs are not drawn; the per-project graph stays a project
  document graph.

## Impact

- `packages/core/src/knowledge/service.ts` — `graph()` membership and
  structural edges. Helper for "is this hub a stub?" in `files.ts`.
- `packages/core/src/knowledge/knowledge.test.ts` — stub omitted, populated
  SHARED included, no fake project edges, project filter excludes
  workspace/decisions.
- `docs/API.md` — one line on `GET /knowledge/graph` omitting stub hubs and
  adding workspace→shared/decisions edges.
- UI fixtures in `knowledgeGraph.test.tsx` / `graphFilters.test.tsx` stay
  valid as caller-supplied graphs; no layout/zoom change (VS-175).
- CLI `conductor knowledge graph` reflects the same payload. No Telegram/TUI.
- No schema, no new route, no `KnowledgeGraph` type change.
