# Proposal: A conductor can read incidents back

## Why

`ac_incident` made the incident table write-only for agents: a conductor that files an incident (or is woken to review one, as the VS-220 daily-incidents routine will be) has no way to list or read them back — only a logged-in human can, via the session-auth HTTP routes. Everything underneath already exists (`IncidentsService.get`/`list`, both HTTP routes); the gap is the MCP surface, plus a time bound so a repeating routine sees only what is new instead of re-reading the same incidents every day.

## What Changes

- Two new **conductor-only** MCP tools over the existing `IncidentsService`:
  - `ac_incident_list({reporterKind?, since?, limit?, includeEvidence?})` → `{ items, total }`, newest first. Lean by default (no `evidence`) like every other MCP list tool; `includeEvidence: true` restores it.
  - `ac_incident_get({id})` → the full incident row.
- **Workspace scoping is decided explicitly**: a conductor's reads are scoped to its own workspace plus workspace-less (daemon-global) rows — never another workspace's. Workers gain no read access at all (`CONDUCTOR_TOOLS`; a worker call is rejected with `forbidden`).
- **Time bound**: `IncidentListQuery` gains `since` (ISO-8601 instant, normalized to daemon timestamp format); the list returns incidents created strictly after it, so a daily sweep bookmarks the newest `createdAt` it processed.
- `ac_incident_list` joins `LIST_TOOLS` so the existing 64 KiB MCP list cap with `truncated: true` applies.
- Filing (`ac_incident`), the HTTP routes `GET /api/incidents[/:id]` and their `session` auth are unchanged.

## Capabilities

### New Capabilities

- `incidents/conductor-read`: a conductor can list and read system incidents through MCP, scoped to its own workspace (plus workspace-less rows), bounded by time, with workers excluded.

### Modified Capabilities

<!-- none: filing, the global page and the HTTP routes are unchanged -->

## Impact

- `packages/core/src/incidents/index.ts` — `IncidentListQuery` gains `since` and `workspaceId`; `get()` gains an optional scoping arg; list/get SQL gains the filters. No migration (text columns, existing indexes suffice).
- `packages/shared/src/tools.ts` — `CONDUCTOR_TOOLS` gains the two names.
- `packages/server/src/tools.ts` — two tool registrations; `packages/server/src/mcp.ts` — one entry in `LIST_TOOLS`.
- Tests: `packages/core/src/incidents/incidents.test.ts`, `packages/server/test/incidents.test.ts`, `packages/shared/src/tools.test.ts`.
- Docs: `docs/PLAN.md` §9.2, `docs/API.md` MCP section, `templates/conductor.AGENTS.md.tmpl` tool line.
