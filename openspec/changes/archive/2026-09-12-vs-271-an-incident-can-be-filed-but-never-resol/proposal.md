# Proposal: An incident can be marked resolved

## Why

`ac_incident` (VS-174) is write-only and `ac_incident_list`/`ac_incident_get` (VS-222) are read-only:
an incident, once filed, exists forever with no lifecycle at all. A conductor running a scheduled
incident-review routine has no way to record that it looked at a row and dealt with it, so every
future fire re-reads the same historical incidents and re-reaches the same conclusion. The routine
that surfaced this (VS-271's origin) was literally instructed to "clear all incidents when done" and
could not, because no verb for that exists.

Everything needed already exists except the resolution itself: `IncidentsService` has `create`/`get`/
`list`; the workspace-scoping and `since`-cursor machinery `ac_incident_resolve` needs is the same
machinery `get`/`list` already have. The gap is one new tool, five new columns, and a default that
hides what has already been dealt with.

## What Changes

- A new **conductor-only** MCP tool `ac_incident_resolve({ id, resolution, ticketId? })`:
  - `resolution` is a required free-text reason (1-2000 chars) — a resolution with no explanation is
    nearly as unhelpful as no resolution.
  - `ticketId` is an optional, unvalidated reference to the ticket that fixed the cause.
  - Records `resolvedAt`, `resolvedByAgentId`, `resolution`, `resolutionTicketId` on the incident and
    returns the updated row.
  - Scoped exactly like `ac_incident_get`: unknown id is `not_found`, another workspace's incident is
    `forbidden`.
  - Resolving an already-resolved incident is rejected with `wrong_status`; it does not overwrite the
    existing resolution.
- **No automatic/inferred resolution.** A ticket landing, merging, or naming an incident in its
  description never resolves it. An incident is often fixed by work that never mentions it, and
  coupling the two surfaces would silently mis-resolve (or fail to resolve) rows — resolution stays a
  deliberate, explicit call.
- `ac_incident_list` gains an optional `status` filter (`open` | `resolved` | `all`), **defaulting to
  `open`** when the caller omits it. This is the change that makes a repeated review incremental: a
  routine that does nothing but call `ac_incident_list` twice, resolving what it found in between,
  sees nothing new the second time. The default lives in the *tool's* input schema, not in
  `IncidentsService.list()` — the service leaves `status` unfiltered when it is unset, exactly like
  `all`. This matters because `list()` has a second caller, the session-authenticated `GET
  /api/incidents` route that feeds the web app's global Incidents page, and that route must keep
  showing every incident, resolved or not — see the next bullet.
- No new "acknowledged" state. It would sit in the same "still needs action" bucket as `open` for any
  review sweep, with no behavioural difference — pure noise for the completeness it buys.
- The four columns needed are additive (`ALTER TABLE ... ADD COLUMN`, no `CHECK`), so no
  foreign-keys-off table rebuild is required (unlike VS-259's `agents`/`decisions` rebuilds).
- `ac_incident` (filing) and the session-authenticated HTTP routes are genuinely unchanged: `GET
  /api/incidents` passes no `status` to `list()`, which — per the previous bullet — filters nothing
  when `status` is unset, so the human's page keeps seeing every row, resolved or not, with the new
  columns simply appearing in the existing `SELECT *` response.
- **Follow-up outside this change's code:** the human's "Incident Resolution" routine instruction
  currently says "Clear all incidents when done," which has no meaning. This proposal's design.md
  drafts the corrected instruction text for whoever runs `ac_routine_update` against that live routine
  after this ships — a worker has no access to that weaver-only tool, so the text is handed off rather
  than applied here.

## Capabilities

### New Capabilities

- `incidents/resolution`: a conductor can mark a filed incident resolved with a reason and an optional
  ticket reference, cannot resolve the same incident twice, cannot resolve another workspace's
  incident, and resolution is never inferred automatically. Workers gain no resolve access.

### Modified Capabilities

- `incidents/conductor-read`: `ac_incident_list` gains a `status` filter defaulting to `open`, so
  resolved incidents no longer surface in a default sweep.

## Impact

- `packages/db/src/migrations/0028_incident_resolution.sql` — new migration: `resolved_at`,
  `resolved_by_agent_id`, `resolution`, `resolution_ticket_id` on `incidents` (plain `ADD COLUMN`s).
- `packages/shared/src/types.ts` — `Incident` gains the four nullable fields.
- `packages/shared/src/enums.ts` — `INCIDENT_STATUS_FILTERS = ['open', 'resolved', 'all']`.
- `packages/shared/src/tools.ts` — `WEAVER_TOOLS` gains `ac_incident_resolve`.
- `packages/core/src/incidents/index.ts` — `IncidentsService.resolve()`; `IncidentListQuery` gains
  `status`; `list()`'s `WHERE` (and its `total` count query, which must share the same filter) gains
  the status clause — no default; unset means unfiltered. The tool applies `open`.
- `packages/server/src/tools.ts` — `ac_incident_resolve` registration; `ac_incident_list`'s input gains
  `status`.
- Tests: `packages/core/src/incidents/incidents.test.ts`, `packages/server/test/incidents.test.ts`,
  `packages/shared/src/tools.test.ts`.
- Docs: `docs/PLAN.md` §9.2, `docs/API.md` MCP section.
- No UI change: the global Incidents page keeps listing every row, resolved or not, unchanged — a
  resolved-state indicator there is a follow-up, not part of this change.
