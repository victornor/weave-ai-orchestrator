## Context

See `proposal.md`. Constraints that shape the approach:

- Global pages already live outside `/w/$ws` (`/needs`, `/live`, `/chats`). `AppShell` runs with
  `ws` null on those paths (`onGlobalPage`), fans in `FanInStreams` per listed workspace, and does
  not call `setWorkspaceId`. Map is a fourth sibling, not a new chrome pattern.
- `api.ws(workspace, path)` and every `qk.*(ws, …)` already take an explicit workspace id (VS-128).
  `useWorkersMany` / `useTicketsMany` / `useWorkspaceProjects` already fan out. `useRoles` and
  `useKnowledgeIndex` still bind `useWs()` and need the same optional-id / `*Many` treatment.
- The per-project knowledge graph (`KnowledgeGraphView` + `packages/ui/src/lib/graph/`) already has
  a live `d3-force` simulation, zoom/pan/fit, label counter-scale, reduced motion, phone neighbour
  list, and theme tokens (`knowledge/graph-exploration`). Node kinds there are `hub` | `doc`. Map's
  kinds are different; the canvas primitives are not.
- jsdom has no layout. Route tests mock `../api/hooks` wholesale. New radio/radiogroup controls in
  shared chrome break bare `queryByRole('radio')` in `chat.test.tsx` (VS-126).
- Phone: five tabs are a hard spec. Global destinations go in More.
- VS-174 Incidents is not on this branch. Map appends after Chats. If Incidents lands first, Map
  remains a sibling in `GLOBAL_NAV`; do not wait on it.
- Roles are project-scoped (`Role.projectId`). The conductor is an `Agent` of kind `conductor`, not
  a `Role`. In-flight ticket statuses are the non-queued non-terminal set listed in the spec.

## Goals / Non-Goals

**Goals:**

- `/map` as a root sibling of `/needs` / `/live` / `/chats`, with the existing sidebar chrome.
- Assemble the graph in the client from existing per-workspace HTTP; no new daemon route.
- Reuse `lib/graph/` (simulation, viewport, hull, reduced motion) with a Map-specific model.
- Partial failure per workspace; empty workspace still draws a workspace node.

**Non-Goals:**

- A daemon-level `/map` or multiplexed graph API.
- Replacing the per-project knowledge graph, Live, Chats, Needs you, or Team.
- Worker nodes. Document-level knowledge nodes.
- Telegram, TUI, PLAN behaviour outside §21.1's rail IA note.

## Decisions

### D1. Route is `/map`, outside `/w/$ws`

Same acceptance criterion as VS-168: reachable without picking a workspace first. `DaemonLayout` /
`AppShell` already supports this. Add `/map` next to `/chats`. Extend `onGlobalPage` so FanInStreams,
no-active-group, and "do not setWorkspaceId" all apply.

`/` still redirects to the remembered workspace's Needs you. Map is a destination, not the new home.

**Rejected:** `/w/$ws/map` (fails "without picking a workspace"). **Rejected:** embedding the graph
on an existing global page.

### D2. Fan-out existing endpoints; assemble the graph in the UI

Per listed workspace:

1. `useWorkspaceProjects` / projects list (already fanned).
2. `useRolesMany` (new; same shape as `useWorkersMany`).
3. `useTicketsMany` (exists; in-flight filter is client-side against the spec's status set).
4. `useKnowledgeIndex` with explicit `ws` (or `useKnowledgeIndexMany`) — file list only, no bodies.
5. `useConductor` with explicit `ws` (or a tiny many-hook) for the conductor node.

Membership and edges are a pure function `buildMapModel(...)` in `packages/ui/src/lib/map/` (or
next to `lib/graph/`), unit-tested, so the route is a thin consumer. Stable node ids:
`ws:<id>`, `project:<id>`, `role:<id>`, `ticket:<id>`, `conductor:<agentId>`,
`knowledge:project:<id>` / `knowledge:ws:<id>`.

Partial failure: skip a workspace whose queries errored, keep the others, surface retry for the
failed id. Do not wait for every workspace before drawing the ones that loaded (after the first
success); the page-level loading state is only while *no* workspace has produced nodes and at least
one fetch is still outstanding, plus the workspace-list loading case.

**Rejected:** a new `GET /map` (out of scope; N workspaces is small; VS-168 set the precedent).
**Rejected:** fetching `/knowledge/graph` per project (that is the document graph; Map wants one
node per project).

### D3. Reuse `lib/graph/` primitives, not `KnowledgeGraphView`

Extract nothing unless a function is already generic (`createSimulation`, `fitTo`, `zoomAround`,
`labelDetail`, `hullPath`). Map gets its own view (`GlobalMap.tsx` + a `MapCanvas` that speaks
Map node kinds) so KnowledgeGraphView's hub/doc colour, search, group-filter and detail panel stay
untouched.

The simulation, zoom/pan/fit, label counter-scale, reduced-motion one-pass settle, and phone
neighbour-list pattern are copied at the call-site level from KnowledgeGraphView — same behaviour
the spec requires, not a shared component that would couple the two graphs' models.

If VS-175 has already generalised the canvas by the time this applies, use that canvas and pass
Map's model in. Do not block on VS-175.

**Rejected:** iframe / second copy of d3-force with a different zoom story (ticket: "zoom/pan like
the knowledge-graph pass … or at least not tiny unzoomable blobs"). **Rejected:** a static
non-zoomable tree.

### D4. Node kinds and in-flight membership

| Kind | Source | Open action |
|---|---|---|
| workspace | `GET /workspaces` | `/w/$ws/needs` |
| project | `GET /projects` | `/w/$ws/p/$slug` |
| conductor | `GET /conductor` | `/w/$ws/chat` |
| role | `GET /roles`, status ≠ `retired` | `/w/$ws/team` |
| ticket | `GET /tickets`, status in the in-flight set | `/w/$ws/tickets/$id` |
| knowledge | `GET /knowledge` files, grouped by `projectId` | `/w/$ws/knowledge` (project query when applicable) |

In-flight = `proposing | proposed | approved | in_progress | in_review | merging | blocked`.
Not `ACTIVE_TICKET_STATUSES` (that includes `todo` and drops `proposed` / `in_review` / `blocked`).
`todo` is queued on the board; the map is the work that has started.

Opening a node **does** switch workspace context — the human left Map, same as a global Live cell.

**Rejected:** worker nodes (ephemeral; the ticket asked for roles and tickets tied to them).
**Rejected:** one node per knowledge document (duplicates VS-175; drowns the instance graph).

### D5. Cluster visually by workspace; legend by kind

A translucent hull per workspace (the existing `hullPath`) makes ownership obvious even before
reading edges. Colour for hulls comes from a workspace index into the same token palette the
knowledge graph uses, not from project colour (projects already have their own colour on the rail;
the map encodes *kind* with shape and *workspace* with cluster colour).

A legend names the node kinds. Hiding a kind excludes those nodes and their edges and reheats the
layout. Hiding a workspace is the same as a failed workspace: its cluster disappears, others stay.

Do not add radio/radiogroup controls in the legend (VS-126).

### D6. PLAN §21.1 gets a rail note; no API.md

UI route, not an HTTP route. Add Map to the global-section sentence that today lists Needs you,
Live and Chats. No `docs/API.md` edit.

## Risks / Trade-offs

- [N workspaces × (projects + roles + tickets + knowledge + conductor) queries] → accepted; typical
  daemon has a handful of workspaces. FanInStreams already open on any global page. Knowledge index
  is metadata, not bodies.
- [Instance graph larger than a project knowledge graph] → in-flight-only tickets and one knowledge
  node per project keep it at "workspaces × (projects + roles + live work)", not "every document".
  Fit-on-open and bounded zoom are the escape hatch.
- [jsdom cannot prove zoom/pan] → tests assert node/edge membership, hrefs, empty/partial-failure,
  neighbour-list on the phone media query, and that wheel/pointer handlers are bound; visual packing
  is CSS + the existing `lib/graph` unit tests.
- [Route-test mock of `../api/hooks` breaks when hooks gain a `ws` argument] → add the export in
  every wholesale mock, then re-run the ui suite.
- [VS-174 Incidents may land in the same `GLOBAL_NAV` array] → append Map after Chats; resolve
  order on rebase if Incidents inserted itself. Spec does not pin Map's index against a page that
  does not exist on this branch.

## Migration Plan

None. No stored data, no API, no flag. Rollback is revert. Existing `conductor.ws` is untouched.

## Open Questions

None. Route, fan-out, node kinds, in-flight set, and knowledge-as-one-node-per-project are
judgements inside the accepted contract.
