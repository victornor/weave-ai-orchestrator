## Context

See `proposal.md`. Constraints that shape the approach:

- MCP tools today write through `ToolCtx.ws.services` (workspace `CoreServices`). `ToolCtx` has no daemon-level handle. Daemon-wide state that already exists (`upgrades`) lives in `daemon.sqlite` via `AppDeps`, not `CoreServices`.
- `openDaemonDb` runs the same migration set as a workspace db. `upgrades` is the precedent: the table exists in both files; only `daemon.sqlite` is read and written.
- VS-168's global pages fan out per-workspace HTTP because the data already lived per workspace. Incidents do not exist yet; the grouping axis is conductor vs worker, not workspace.
- Global chrome already exists: `/needs`, `/live`, `/chats` as root siblings of `/w/$ws`; `GLOBAL_NAV` in `packages/ui/src/app/nav.ts`; More menu lists those three above per-workspace leftovers; five phone tabs are a hard spec.
- `ac_report` is the status protocol. A new tool must not collide with that name. VS-161 keeps MCP list payloads small; a list tool for agents is not required.
- CLAUDE.md: new statuses/kinds live in `shared`; new routes go in `docs/API.md`; PLAN identifiers win on conflict.

## Goals / Non-Goals

**Goals:**

- One MCP write path both kinds of agent can call, one daemon-level store, one HTTP list, one global page.
- Reporter kind derived from the run, never from the payload.
- Incidents join the existing global nav without a sixth tab or a per-workspace copy.

**Non-Goals:**

- Resolve / ack / close. Append-only.
- Auto-creating tickets, notifying Needs you, or posting to chat.
- An MCP list/get tool.
- Telegram, TUI, CLI.
- A daemon-wide SSE multiplex.

## Decisions

### D1. Store incidents in `daemon.sqlite`, not in workspace dbs

The page is daemon-wide and the split is conductor vs worker. Per-workspace rows plus VS-168-style fan-out would make the human's list N queries and would hide a system failure behind whichever workspace the agent happened to be in.

Migration `0022_incidents.sql` creates `incidents` with no foreign keys (same as `upgrades`). Writers and readers use the daemon db only. Workspace copies of the table stay empty.

**Rejected:** workspace-scoped table + fan-out (wrong axis; extra plumbing for a list that is not per-workspace). **Rejected:** a new database file (one daemon db already holds upgrades and auth).

### D2. Tool name is `ac_incident`, on `COMMON_TOOLS`

Input: `title` (1–200), `whatFailed` (1–2000), `tryingToDo` (1–2000), `evidence?` (≤8000). Output: `{ id, createdAt, reporterKind }`. Empty required fields → `validation`. Description tells the agent to file when an MCP call fails or they cannot do something because of AgentConductor, and never to put secrets in evidence.

`reporterKind` is `claims.agentKind` (`conductor` | `worker`). Workspace, agent, run, ticket and project ids come from the run token, not the payload.

Wire `IncidentsService` onto `AppDeps` and `ToolCtx` so the MCP handler and `POST /api/w/:ws/agent/tools/ac_incident` can write the daemon db. `mcpRoutes` / the agent-tools route construct `ToolCtx` with that service.

**Rejected:** `ac_incident_report` (reads as `ac_report`). **Rejected:** conductor-only (workers hit the same class of failure). **Rejected:** a caller-supplied `reporterKind` (misclassification).

### D3. HTTP is `GET /api/incidents` (daemon-level)

Session cookie / operator bearer only. Query `reporter=conductor|worker`, `limit` default 100 max 200. Newest first. Optional `GET /api/incidents/:id`. Run tokens stay limited to `/mcp/runs/:runId` and `/api/w/:ws/agent/*` — they cannot list.

No POST from the human in this change; agents file via MCP.

Document in `docs/API.md` under Daemon-level. PLAN §9.2 Common tools gains `ac_incident`.

**Rejected:** `GET /api/w/:ws/incidents` (implies a workspace page we are not building).

### D4. Route is `/incidents`, next to the VS-168 trio

Register as a root sibling of `/w/$ws`, same `AppShell` without `WorkspaceProvider`. `GLOBAL_NAV` appends `{ key: 'global-incidents', label: 'Incidents', to: '/incidents', glyph: 'failed' }`. Order: Needs you, Live, Chats, Incidents. More menu: Global Incidents after Global Chats. `AppShell.onGlobalPage` includes `/incidents`. Visiting it does not call `setWorkspaceId`.

Page: filter All / Conductor / Worker (URL `?reporter=` so it is addressable, like Settings `?section=`). Rows newest first; title, reporter kind, createdAt, workspace name when known; expand for whatFailed / tryingToDo / evidence. Empty / loading / error as specified.

No live SSE. Fetch on mount; refetch on window focus. Typical volume is low.

**Rejected:** putting Incidents first in the global section (do not reorder VS-168). **Rejected:** a sixth phone tab. **Rejected:** a per-workspace `/w/$ws/incidents`.

### D5. Prompts name the tool; skills list it

Tool description is the contract the model sees. Also add one line to `templates/conductor.AGENTS.md.tmpl` and `templates/worker.AGENTS.md.tmpl`: file `ac_incident` when a system call fails or you cannot proceed because of AgentConductor; do not wait for the human to notice in chat; this is not a ticket. List the tool in `skills/*/references/tools.md` and PLAN §9.2.

Without that, the tool exists and nothing calls it.

### D6. Shared enum `INCIDENT_REPORTER_KINDS`

`['conductor', 'worker']` in `packages/shared/src/enums.ts`. Incident type in `packages/shared`. `IncidentsService` in `packages/core`. Tests: service unit, MCP tool, HTTP list (session vs run token), `globalIncidents.test.tsx`, plus existing `workspacenav`, `moreSheet`, `router` tests extended.

## Risks / Trade-offs

- [Agents dump secrets into evidence] → tool description forbids it; no redaction in v1. Same trust as ticket comments.
- [A stuck agent loops `ac_incident`] → two identical files are two rows by spec. A later cap can sit on the service; not this change.
- [Empty `incidents` table in every workspace db] → accepted; same as `upgrades`. Do not read it there.
- [Page is not live] → accepted; refetch on focus. A daemon SSE is a different ticket.
- [Route-test mocks of `../api/hooks`] → add any new export to wholesale mocks; re-run the ui suite.

## Migration Plan

Forward-only SQL migration. Empty table. Rollback is revert; leftover empty tables in workspace dbs are harmless. No backfill.

## Open Questions

None. Storage, tool name, reporter derivation, route, filter, and phone-More are judgements inside the accepted contract.
