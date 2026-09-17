## Why

On 2026-09-17 captain asked the weaver to clear a backlog of open incidents. `weave_incident_list`
returned zero open, because it is scoped to the calling workspace; captain's screen showed fifteen,
because the web Incidents page is global and all fifteen belonged to other workspaces. The one
workspace that owns and can fix Weave AI could neither see nor close the incident reports every other
workspace files. An incident is a defect report about Weave AI itself, filed by whichever agent hit
it, so it belongs to the installation, not the workspace that happened to file it — and the scoping
inverts the feature's whole purpose.

## What Changes

- **`weave_incident_list` returns every workspace's incidents by default.** Every existing filter
  (`reporterKind`, `since`, `limit`, `includeEvidence`, `status`) keeps working unchanged. A new
  optional `workspaceId` narrows deliberately to one workspace; omitting it is the global default.
- **`weave_incident_get` and `weave_incident_resolve` accept an incident from any workspace.** The
  cross-workspace `forbidden` rejection is removed; an unknown id is still `not_found`. Workers still
  get `forbidden` on all three read/resolve tools, and filing (`weave_incident`) is unchanged.
- **Every incident read names its originating workspace.** Alongside the stored `workspaceId`, the
  MCP results carry a human-readable `workspaceName`, so the weaver's relay can say "V OFM" rather
  than a ULID. A workspace-less (daemon-global) incident reports no name.
- **Resolving records where it was resolved from.** `weave_incident_resolve` now stores the resolving
  run's workspace on the incident (`resolvedByWorkspaceId`), so an incident filed in workspace A and
  resolved from workspace B keeps both sides of the audit trail — distinct from the filing workspace.
- **The widening is incidents-only.** Tickets, decisions and knowledge keep their current
  workspace/project scoping; the session-authenticated HTTP routes and the global web Incidents page
  are unchanged (they were already daemon-wide).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `incidents/conductor-read`: incident reads become daemon-wide instead of caller-workspace-scoped;
  each read carries the originating workspace's human-readable name; the list gains an optional
  single-workspace narrowing filter; the time-bounded sweep is stated to span workspaces.
- `incidents/resolution`: resolution accepts an incident from any workspace and records the resolving
  workspace alongside the resolving agent; the caller-workspace scoping requirement is removed.

## Impact

- `packages/core/src/incidents/index.ts` — drop the `get`/`resolve` workspace scope; redefine the
  list's `workspaceId` as an exact narrowing filter; resolve records `resolvedByWorkspaceId`.
- `packages/db/src/migrations/0051_incident_resolved_workspace.sql` — one nullable column on
  `incidents`.
- `packages/shared/src/types.ts` — `Incident.resolvedByWorkspaceId`.
- `packages/server/src/tools.ts` — the three incident tools become global; `weave_incident_list` gains
  `workspaceId`; results are decorated with workspace names; `weave_incident_resolve` passes the
  caller's workspace.
- `packages/server/src/types.ts`, `mcp.ts`, `routes/agent.ts` — the tool context carries the loaded
  workspaces so a name can be resolved.
- Tests: `packages/core/src/incidents/incidents.test.ts`,
  `packages/server/test/incidents.test.ts`, `packages/ui/src/test/v2incidents.test.tsx`.
- Docs: `docs/API.md`, `docs/PLAN.md` §9.2 and the §23 decision log.
- No HTTP route, web page, plugin or other capability's scoping changes.
