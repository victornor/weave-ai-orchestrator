## Context

Incidents are stored daemon-level, in `daemon.sqlite` (`incidents`, migration `0022`), but the three
weaver MCP tools around them are scoped to the caller: `weave_incident_list` passes
`ctx.claims.workspaceId` into `IncidentsService.list`, and `weave_incident_get`/`_resolve` pass it as
`IncidentGetScope`, which throws `forbidden` for a row belonging to another workspace. The
session-authenticated HTTP routes (`GET /api/incidents`, `GET /api/incidents/:id`) and the global web
Incidents page already read every workspace's rows — the MCP surface is the only scoped one. The
incident row carries `workspace_id` (the filing run's workspace), which is what the web page maps to a
display name through `GET /api/workspaces`; the daemon's loaded workspaces map
(`AppDeps.workspaces`, keyed by both slug and internal id) is the only place a name is available to
server code. See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**

- The three weaver incident tools read and resolve any workspace's incidents, with the existing
  filters intact and a deliberate single-workspace narrowing available.
- A human-readable originating-workspace name on every MCP incident result.
- A resolution records both the filing workspace and the resolving workspace.
- The widening touches incidents only; tickets, decisions, knowledge and the HTTP routes are exactly
  as they are.

**Non-Goals:**

- Gating global incident access to a particular workspace.
- Multi-tenant isolation of incident content.
- Changing what an incident contains, when one is filed, or auto-resolving incidents.
- Denormalizing the workspace name onto the incident row.

## Decisions

### Global access is unconditional, not gated to the workspace holding the agent-conductor project

Captain's instruction is "we should always return all incidents for all workspaces", and gating would
require a reliable "this workspace owns the Weave AI project" signal that does not exist: a project's
slug is configurable, can be renamed, and may be absent on a deployment that runs Weave AI against
some other project. A gate built on a fragile signal fails precisely in the situation it exists for,
and adds a special case whose negative path has to be maintained. Unconditional global access is the
simpler rule and matches the instruction; the per-incident workspace tag is what keeps a reader
oriented. The alternative — gate on "a project named agent-conductor exists in this workspace" — was
rejected for those reasons.

The disclosure question is a real one and is examined rather than left implicit: incident titles and
evidence can quote another workspace's ticket text, paths and error output, so on a deployment where
workspaces belong to different people, unconditional reads would cross a privacy boundary. This
product is currently a single-owner install, and the human's global Incidents page already shows every
incident across workspaces on the same daemon — so the only new reader this creates is a weaver agent
in one workspace. Multi-tenant isolation is explicitly out of scope for this ticket; if Weave AI is
ever run with workspaces belonging to different people, incident reads need to be gated (and that is
a separate, larger change involving both the MCP tools and the HTTP/page surfaces, which are global
today too).

### Workspace names are resolved at read time, in the server layer

The incident row keeps only `workspace_id`. `weave_incident_list` and `weave_incident_get` decorate
each returned row with `workspaceName`, resolved from the daemon's loaded `workspaces` map at the
moment the read is served. Storing the name on the incident at filing time was rejected: it
denormalizes a value the daemon already owns, it would need a backfill for existing rows, and it would
go stale on a rename. Resolving in the server layer (not in `IncidentsService`, which is in `core`
and has no workspaces registry) means `ToolCtx` gains the loaded `workspaces` map; both tool front
doors (`mcp.ts` and `routes/agent.ts`) already have `AppDeps` and pass it. The field is output-only —
`Incident` (the stored row, shared with the web app) is not changed to carry it.

### The narrowing filter is an exact match on the filing workspace

`IncidentsService.list`'s `workspaceId` filter changes from the old read-scope semantics
(`workspace_id = ? OR workspace_id IS NULL`) to an exact `workspace_id = ?`. "Narrow to a workspace"
should mean that workspace; a daemon-global (workspace-less) row was not filed from it and is visible
in the unfiltered list anyway. Reusing the old scope semantics was rejected because it silently mixes
workspace-less rows into a one-workspace result and its `total`.

### Resolution records the resolving workspace as its own column

`resolve` gains `resolvedByWorkspaceId`, stored from the calling run token (`ctx.claims.workspaceId`),
alongside the existing `resolvedByAgentId`. The filing workspace stays on `workspace_id`. This is what
keeps the audit trail from collapsing "filed in A" and "resolved from B" into one field once
`forbidden` is gone. The column is added by a plain additive migration (`0051`), nullable, no CHECK —
the same shape as migration `0028`'s resolution columns. The tool output decorates both workspaces
with names.

### The core service loses its scope parameters; the HTTP routes are untouched

`IncidentGetScope` and the `scope?` parameters on `get`/`resolve` are removed, because after this
change there is no caller that wants them and leaving a dead scope parameter would invite the old
behaviour back. The HTTP routes already call `get(id)`/`list({...})` without scope, so they are
unaffected by construction. The session-only auth on them is unchanged.

### The `since` sweep needs no mechanism change, only a stated span

The bound is `created_at > ?` ordered over the whole table, so it already spans workspaces correctly;
the same-millisecond stable-block contract is global too. The spec states the cross-workspace
behaviour and a test covers it, but no code changes.

## Risks / Trade-offs

- **A weaver in one workspace can now read another's incident text.** Accepted by the decision above;
  the workspace tag and the ticket's explicit single-owner framing are the mitigation. On a future
  multi-tenant deployment this needs a real gate → out of scope, flagged in the proposal.
- **The archived `incidents/conductor-read` Purpose still describes workspace scoping.** `openspec
  archive` preserves an existing capability's Purpose and ignores one in the delta, so the change
  edits `openspec/specs/incidents/conductor-read/spec.md`'s Purpose directly in the same change (the
  OpenSpec docs' own instruction for changing an existing Purpose). If that edit is skipped, the
  requirements are still correct but the summary prose is stale.
- **Pre-existing resolutions have no `resolvedByWorkspaceId`.** The column is null for rows resolved
  before this change; their resolving workspace cannot be reconstructed from anything stored. Stated,
  not silently backfilled.
- **The narrowing filter changes an existing core test's expectation.** The VS-222 test asserting
  "caller workspace plus workspace-less" is updated to the new exact semantics; that is the intended
  behaviour change, not a regression.

## Migration Plan

1. Additive migration `0051_incident_resolved_workspace.sql` adds the nullable column; every existing
   row reads `null`.
2. No data backfill and no rollback step beyond reverting the migration commit: application code
   reads the column only through the incident service, and a database without it is simply the old
   schema.
3. The widening takes effect for the weaver as soon as the daemon runs the new release.

## Open Questions

None that change the specs or task breakdown. Multi-tenant gating is deliberately deferred and named
out of scope above.
