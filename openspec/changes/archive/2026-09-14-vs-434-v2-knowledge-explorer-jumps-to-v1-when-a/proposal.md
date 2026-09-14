# V2 Knowledge Explorer keeps the reader under `/v2`

Tracker change for [VS-434](weave://tickets/VS-434). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: in V2, opening a document from Knowledge → Explorer throws the reader into V1.

`packages/ui/src/v2/knowledge/KnowledgeExplorerPage.tsx` renders V1's
`routes/KnowledgeExplorer.tsx` inside the V2 frame. That component writes its selection to a
**hard-coded V1 route**:

```ts
go('/w/$ws/knowledge', { params: { ws }, search, replace: true });   // :131
go('/w/$ws/artifacts/$key', { params: { ws, key: a.key } });          // :237
```

The V2 route is `/v2/w/$ws/knowledge/explorer` (`router.tsx:226`), so opening a doc, a hub or an
archive file replaces it with V1's `/w/$ws/knowledge`. The weaver-artifact link jumps to V1's
artifact page too; V2 already has `/v2/w/$ws/artifacts/$key`.

The same class of bug exists one level down: `routes/KnowledgeDocs.tsx:334` renders a revision's
ticket link as `<A to="/w/$ws/tickets/$ticketId">`, and that panel (`KnowledgeDocPanel`) is reused by
V2's Knowledge Home, Explorer and Graph tabs, so following a ticket from a hub's revisions leaves
V2.

## What changes

The host that renders a shared V1 component supplies **the routes that component navigates to**,
instead of the component spelling a V1 path. One small context does this, so no route is hard-coded
inside a V1 component that V2 can render:

- `packages/ui/src/app/host.tsx` — `HostRoutes` (`knowledgeExplorer`, `knowledgeExplorerSearch`,
  `artifact`, `ticket`), `V1_HOST_ROUTES` (today's values, the default) and `V2_HOST_ROUTES`
  (`/v2/w/$ws/…`).
- `packages/ui/src/v2/V2Root.tsx` — provides `V2_HOST_ROUTES` around the whole `/v2` tree, so every
  V1 component reused under V2 reads V2 addresses.
- `packages/ui/src/routes/KnowledgeExplorer.tsx` — selection goes to `host.knowledgeExplorer` (plus
  the host's extra search, V1's `tab=explorer`), and the weaver-artifact row to `host.artifact`.
- `packages/ui/src/routes/KnowledgeDocs.tsx` — `KnowledgeDocPanel`'s revision ticket link goes to
  `host.ticket`.

V1 gets the default (`V1_HOST_ROUTES`), so its behaviour is unchanged.

## Sweep

Every V1 component that `packages/ui/src/v2` renders was checked for a `/w/…` navigation. Only the
two above had one; the rest are listed in the delivery comment:

| V1 module reused in V2 | `/w/…` navigation found |
|---|---|
| `routes/KnowledgeExplorer.tsx` (`KnowledgeExplorer`) | yes — selection + weaver artifact (fixed) |
| `routes/KnowledgeDocs.tsx` (`KnowledgeDocPanel`) | yes — revision ticket link (fixed) |
| `routes/KnowledgeGraph.tsx` (`KnowledgeGraphView`) | none |
| `routes/Settings.tsx` (workspace sections, `KnowledgeBudgetsSection`) | none — its `/w/…` writes are in `WorkspaceSettingsRoute` / `DaemonSettingsRoute`, neither reused under V2 |
| `routes/Onboarding.tsx` (`StepRow`, helpers) | none — its `/w/…` write is in the route component, not reused |
| `routes/Changelog.tsx`, `routes/GlobalScheduled.tsx` | only constants/functions imported, no navigation |

## Tests

- V2-hosted `KnowledgeExplorer`: opening a doc, a hub, an archive entry and an artifact each keeps
  the route under `/v2/…`, with the expected search, and uses `replace` so back/forward are not
  perturbed.
- V1-hosted: the written paths are unchanged.
- `KnowledgeDocPanel`'s revision ticket link resolves to `/v2/w/$ws/tickets/$ticketId` in V2 and
  `/w/$ws/tickets/$ticketId` in V1.

## Out of scope

Redesigning the Explorer for V2, and the other open V2 tickets (VS-431, VS-432, VS-433).
