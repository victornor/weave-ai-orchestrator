## Why

Captain works across several workspaces on one daemon. Needs you, Live and Chats are now daemon-wide, but there is still no picture of the whole instance: which workspaces exist, which projects and roles they hold, which tickets are in flight, and where knowledge sits. They asked for a global **Map** — a graph of that structure — next to the other global pages, reachable without picking a workspace first. This is not the per-project knowledge graph (VS-175).

## What Changes

- **Global Map** at `/map`: a graph of every workspace this daemon hosts. Nodes are workspaces, their projects, their roles (including each workspace's conductor), in-flight tickets tied to those roles, and one knowledge node per project (plus workspace-scope knowledge when it exists). Edges make ownership obvious (workspace→project, project→role, role→ticket, project→knowledge).
- **The same global sidebar section** as Needs you / Live / Chats gains a Map link. Phone: More menu, no extra tab. Visiting `/map` does not make a workspace active and does not rewrite the remembered workspace.
- **Empty workspaces do not break the page**; they still appear as a workspace node with nothing hanging off them. Partial failure is per workspace.
- **Zoom, pan, fit**, theme tokens, reduced motion — reuse the knowledge-graph canvas primitives (`packages/ui/src/lib/graph/`) so nodes are not tiny unzoomable blobs. Phone defaults to a neighbour list, with the canvas one tap away.
- **Per-workspace routes stay.** Clicking a node that belongs to a workspace navigates into that workspace (project overview, ticket, team, knowledge) and *then* switches context — leaving the global page, same as a global Live cell.
- **No new daemon API.** Fan-out the existing per-workspace projects / roles / workers / tickets / knowledge-index endpoints, keyed by workspace id the way VS-168 already does.

## Capabilities

### New Capabilities

- `workspace-navigation/global-map`: the `/map` page — instance-wide graph of workspaces, projects, roles, in-flight tickets and knowledge nodes; membership and edges; zoom/pan/fit; empty/loading/partial-failure; phone neighbour-list default.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: Map joins Needs you / Live / Chats in the global section and in the phone More menu. Existing scenario names are kept.

## Impact

- `packages/ui/src/router.tsx` — `/map` as a sibling of `/needs`, `/live`, `/chats`.
- `packages/ui/src/app/nav.ts`, `WorkspaceNav.tsx`, `MoreSheet.tsx`, `AppShell.tsx` — Map in `GLOBAL_NAV`; `onGlobalPage` includes `/map`; FanInStreams already covers listed workspaces on a global page.
- `packages/ui/src/api/hooks.ts` — `useRoles` / `useKnowledgeIndex` (and any other hook Map needs) take an optional workspace id or a `*Many` fan-out, same pattern as `useWorkersMany` / `useTicketsMany`.
- `packages/ui/src/lib/graph/` — reused for simulation, viewport, hull, reduced motion. Map gets its own model (node kinds are not hub/doc). KnowledgeGraphView is not replaced.
- `packages/ui/src/routes/GlobalMap.tsx` (new) plus tests for the route, sidebar membership, empty/partial-failure, and node/edge membership.
- `docs/PLAN.md` §21.1 — Map in the global-section rail note.
- No daemon, schema, event, CLI, TUI or Telegram change.

## Out of scope

- Replacing Live, Chats, Incidents, Needs you, or the per-project knowledge graph.
- Telegram / TUI.
- Editing knowledge from the map.
- A new daemon-level `/map` or multiplexed graph API.
- Worker nodes as a fifth kind (workers are ephemeral; tickets attach to roles).
- Exploding every knowledge document onto the instance map (that is VS-175's per-project graph).
