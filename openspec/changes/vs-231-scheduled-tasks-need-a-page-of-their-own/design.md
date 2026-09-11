## Context

See proposal.md for motivation. Routines live per workspace in that workspace's `routines` table
(`packages/core/src/routines`). Each fire already enqueues a `source: 'routine'` wake whose payload
carries `routineId`; VS-220's `usage()` join finds the conductor run via
`COALESCE(w.run_id, parent.run_id)`. A finished run already stores `status`, `startedAt` /
`finishedAt` / `createdAt`, `summary` (from the structured report, else truncated final text, else
the failure message), and `result` (the parsed report). That is the history. `last_fired_at` stays
the one-instant pointer it is; we do not add a column or a table.

The UI already has a Settings → Scheduled tasks section (`ScheduledSection` in
`packages/ui/src/routes/Settings.tsx`) that lists one workspace's routines and can add / pause /
resume / remove. It cannot edit instruction or schedule, and it cannot show fires. VS-230 split
settings into `/w/$ws/settings` and `/settings`; `scheduled` is still a workspace-area row in
`SETTINGS_SECTIONS`. Global Live (`/live`) fans `useWorkersMany` across `useWorkspaces()` with no
`WorkspaceProvider`. Global Chats uses one pane per workspace wrapped in a provider. Incidents is
the wrong shape: it reads daemon.sqlite, and routines are not there.

`AppShell.onGlobalPage` currently treats `/needs`, `/live`, `/chats`, `/incidents`, `/map`,
`/settings`. FanInStreams is mounted on those except `/chats`. HTTP/1.1 still budgets about six
EventSources per origin (VS-227); this page MUST NOT add another.

## Goals / Non-Goals

**Goals:**

- One composed list of every workspace's routines, Global Live's data pattern.
- Fire history and lifetime count from the existing wake→run join.
- Create and edit on that page, including a workspace picker when more than one workspace exists.
- Remove the Settings section and redirect leftover `?section=scheduled` links.
- Leave firing, re-arm, overlap, missed-fire and action policy exactly as they are, with the
  existing firing tests still asserting them.

**Non-Goals:**

- No fire-history table, no new `routines` columns, no daemon-level `/api/routines` aggregator.
- No MCP or CLI change.
- No new EventSource / SSE.
- No change to how a fire becomes a wake.
- No per-workspace Scheduled page that would sit beside the global one.

## Decisions

### D1 — Follow Global Live's fan-out, not Chats panes and not a daemon API

The page is `GET /workspaces` then `GET /api/w/:ws/routines` per workspace, composed into one list
with a workspace name on each row (`useRoutinesMany`, same shape as `useWorkersMany`). Mutations
take an explicit workspace id so they work without `useWs()`.

Alternative considered: Chats' one-pane-per-workspace with `WorkspaceProvider remember={false}` —
rejected; stacked create-forms are the wrong layout for a list of alarms, and the existing hooks
would keep depending on a provider the shell does not wrap. Alternative: a daemon `GET /routines`
that iterates workspaces server-side — rejected; that is the Incidents shape, for data that lives
in daemon.sqlite. Routines do not.

### D2 — History is `fires(id)` on the workspace routines service, not a new table

`RoutinesService.fires(id)` returns newest-first rows from the same SQL `usage()` already uses to
find runs, without the usage-window filter and without requiring a run to exist yet:

- one row per `wakeups` row with `source = 'routine'` and `payload.routineId = id`, excluding
  `skipped`;
- `runId` = `COALESCE(w.run_id, parent.run_id)`;
- `firedAt` = the wake's `createdAt`;
- `status` / `summary` from the run when present, else an in-flight/queued status and a null
  summary;
- `sharedTurn` — see D7.

`list()` adds `fireCount` per routine (grouped COUNT of those same wakes) so the page does not
N+1. `GET /api/w/:ws/routines/:id/fires` is the new read. The UI fetches fires when a row is
expanded, not for every row on load.

The join is enough: `Run.status` is the outcome, `Run.summary` is the turn's account. Coalesced
wakes that share a run still list as separate fires (two alarms, one turn) — count wakes, not
distinct runs. The summary is not a per-fire record; D7 is how the page says so when it matters.

### D3 — Settings section is removed; old links redirect

`SETTINGS_SECTIONS` drops `{ key: 'scheduled', ... }`. `ScheduledSection` moves onto the new page
(and gains edit + history). Two UIs for the same records would drift; captain asked for a page of
their own; a `?ws=` filter is the workspace-scoped view.

`redirectForSettingsRoute`: from the workspace route, `section=scheduled` (even after it is no
longer a known section) redirects to `/scheduled` with that workspace id in the search, rather
than falling through as unknown. Daemon-route URLs never named this section.

### D4 — GLOBAL_NAV order: Scheduled before Settings

`{ key: 'global-scheduled', label: 'Scheduled', to: '/scheduled', ... }` is inserted after Map and
before Settings, so Settings stays last in the global block. `/scheduled` joins `onGlobalPage` and
gets FanInStreams like Live/Incidents/Map (not Chats). Route is AppShell, no WorkspaceProvider, a
sibling of `/live` in `router.tsx`.

The live `sidebar-workspaces` spec still omits Settings (VS-230 added the nav entry without a
sidebar delta). This change's sidebar delta lists Settings alongside Scheduled so the spec matches
the rail we are adding to, rather than specifying a list that would drop Settings.

### D5 — Create names a workspace; edit uses the existing PATCH

The add form includes a workspace select populated from `useWorkspaces()`, required when more than
one workspace is listed, implied when there is one. Edit (name, schedule, instruction, action,
pause/resume/remove) uses the existing PATCH/DELETE. Hooks grow an explicit-`ws` variant;
`useRoutines()` that calls `useWs()` stays for any leftover in-workspace caller and is unused once
the settings section is gone.

### D6 — Firing tests are the contract that behaviour is unchanged

`packages/core/src/routines/routines.test.ts` firing cases (due enqueue, pause, missed-fire once,
overlap skip, instruction-as-it-stands) are not rewritten. New tests cover `fires()` / `fireCount`
/ `sharedTurn` only. Server HTTP test covers `GET .../fires`. Apply MUST run those firing cases,
not only the new ones.

### D7 — Label a summary when the run was not only this fire

Gate 3 can fold a due fire into a queued wake, so `Run.summary` is the whole turn: the fire plus a
human message, a digest, other ticket events. Presenting that text as "what this fire did" with
nothing else is the lie the page exists to avoid.

`sharedTurn` is true when `flattenWakes` of the run's claimed wakes (the same walk
`applyRoutineFilingPolicy` already uses) includes any wake that is not this routine — a different
`source`, or a `routine` wake whose `routineId` is not this one. Bundled coalesced wakes count.
Two fires of the *same* routine on one turn do not set the mark; they are this routine.

The page still shows the summary. When `sharedTurn` is true it also says "this run also handled
other work". When the fire was alone, the summary stands as the fire's account.

Alternative considered: hide the summary and show only when/status/cost — rejected; a solo 07:00
alarm is the common case, and captain asked what each fire did. Dropping the summary there throws
away the useful answer to avoid a rare mixed turn, which the label already marks. Alternative:
ignore mixed turns as rare — rejected; VS-220 already coded for coalescing, and that is exactly
when captain would read a misleading story.

## Risks / Trade-offs

- [A fire whose enqueue was skipped never appears] → accepted; it is not a kept wake, and the spec
  says skipped enqueues are not fires. `lastFiredAt` may still have advanced on some skip paths
  (existing VS-220 behaviour).
- [A coalesced turn's summary describes other work] → D7: still show it, labelled "this run also
  handled other work" when `flattenWakes` of the claimed wakes includes anything besides this
  routine. Solo fires stay unlabelled.
- [Two routines coalesced onto one conductor turn share a summary] → listed as two fires pointing
  at the same run, each with `sharedTurn`; honest, and cheaper than splitting a turn after the fact.
- [Fan-out of N routine lists] → same cost as Global Live's worker lists; REST, not EventSource.
- [Dropping the settings section surprises a bookmark] → D3 redirect; pinned by test.
- [Sidebar spec now names Settings] → documents the rail VS-230 already shipped; not a behaviour
  change for Settings itself.

## Migration Plan

No data migration. Ship behind nothing. Old `?section=scheduled` URLs redirect on arrival.
Rollback is reverting the commit; the `routines` table is unchanged.

## Open Questions

None.
