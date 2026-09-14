# V2 shows names, never raw internal ids

Tracker change for [VS-403](weave://tickets/VS-403). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Two V2 screens show raw ULIDs to the operator because a lookup compares two different id systems, or
is missing altogether (VS-402 report, source-located):

- **Needs you**: the decision card's meta line ends with the asking agent's raw id
  (`NeedsYouPage.tsx` passes `askedBy={d.askedByAgentId}` and `DecisionCard.tsx` joins it verbatim),
  instead of the agent's display name.
- **Incidents**: every row's scope label is the workspace's internal ULID. The incident stores
  `workspaceId` from the run-token claim (the internal id), while `GET /api/workspaces` returns `id`
  as the slug, so `workspaces.find((w) => w.id === workspaceId)` never matches and the `?? workspaceId`
  fallback leaks.

## What changes

- **`GET /api/workspaces` exposes the workspace's internal id** alongside the slug it already sends
  as `id`, so a consumer can resolve an incident by whichever id it carries rather than guessing.
- **The Needs you card resolves the asking agent to its name** (the workspace's workers, plus the
  weaver when the asker is the weaver). `V2DecisionCard` takes the resolved name and its meta line
  never emits a raw id — a readable neutral label is the fallback.
- **The workspace-scoped Needs you filter normalises the id systems**: a decision carries the
  workspace's internal id while the route and scope chips carry the slug, so the filter resolves
  either before comparing instead of silently hiding every decision.
- **Incidents resolves each row's workspace by the incident's own id**, falling back to a neutral
  label, never the ULID.
- **The sweep**: every other place in `packages/ui/src/v2` where a name lookup falls back to a raw
  agent/project id is fixed the same way (the Chat decisions pane and inline cards, the Runs list and
  Run detail agent name, the Scheduled project label). Call sites that are safe (e.g. slug-to-slug
  comparisons) are listed in the ticket report.

## Out of scope

V1 is untouched (captain's 2026-09-14 decision). Run ids and artifact/plugin slugs are not names and
keep rendering as references. No product behaviour changes beyond the visible label.
