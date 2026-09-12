# Design: incident resolution lifecycle

## Context

`IncidentsService` (`packages/core/src/incidents/index.ts`) has `create`/`get`/`list` over the
daemon-level `incidents` table (`packages/db/src/migrations/0022_incidents.sql`), which today has no
resolution columns at all — an incident is immutable once filed. `get`/`list` already carry the
workspace-scoping (`read(id, scope)`: `not_found` unknown, `forbidden` cross-workspace) and the
`since`-cursor machinery this change reuses verbatim. `ac_incident_list`/`ac_incident_get` are
weaver-only (`WEAVER_TOOLS`, `packages/shared/src/tools.ts`); `ac_incident` (filing) is in
`COMMON_TOOLS` and stays available to workers.

The nearest existing "state + reason + who" pattern is `decisions.answer()`
(`packages/core/src/decisions/service.ts`): `answered_by_kind`, `answered_by_id`, `answered_at`,
`answer_text`, guarded by a `status !== 'open'` → `wrong_status` check. Decisions can be answered by
either a human or the weaver, so they store both an actor kind and an actor id; incident resolution
can only ever be called by a weaver (the tool is weaver-only), so there is nothing for a kind column
to distinguish — storing just the resolving agent's id is enough.

## Goals / Non-Goals

Goals: a `resolve` verb with a required reason and optional ticket reference; a list default that
hides what is already resolved so a routine's second sweep is empty; the same `not_found`/`forbidden`
scoping already proven for reads; no way to silently overwrite an existing resolution.

Non-Goals: no "acknowledged" state; no automatic/inferred resolution from ticket activity; no change
to filing or to the HTTP routes; no UI change (the global Incidents page keeps rendering every row
unchanged); no validation that a `ticketId` passed to resolve actually exists.

## Decisions

### D1 — Two states (`open`/`resolved`), no "acknowledged"

An incident is either resolved (`resolvedAt` set) or not. The ticket that requested this feature
asked whether "acknowledged but unfixed" earns a third state and answered its own question: it
probably needs a reason to exist beyond completeness. It does not have one here — a review routine's
only two questions are "have I already dealt with this" (state) and "why" (the `resolution` text,
which can say "acknowledged, tracked in TICKET-1, not yet fixed" as prose). A third enum state with no
behavioural difference from `open` in any filter or gate is pure surface area. Alternative considered:
`status: 'open' | 'acknowledged' | 'resolved'` — rejected for that reason; revisit only if a concrete
behavior (e.g. a different list default) needs to key off it.

### D2 — Additive columns, no table rebuild

`resolved_at`, `resolved_by_agent_id`, `resolution`, `resolution_ticket_id` are all nullable with no
`CHECK` constraint, so migration 0028 is four plain `ALTER TABLE incidents ADD COLUMN` statements —
unlike VS-259's `agents`/`decisions`/`roles` rebuilds (which needed `-- ac:foreign_keys_off` because
they were narrowing a `CHECK IN (...)`), nothing here changes an existing column or constraint.
`resolution_ticket_id` is a plain `TEXT`, not a `REFERENCES tickets(id)` foreign key: D5 below decides
it is intentionally unvalidated, so there is nothing to reference.

### D3 — `resolve()` reuses `read(id, scope)`, then guards on `resolvedAt`

```
resolve(id, patch, scope?) {
  const row = read(id, scope);              // not_found / forbidden, same as get()
  if (row.resolvedAt) throw new OcError('wrong_status', `incident ${id} is already resolved`, {
    resolvedAt: row.resolvedAt, resolvedByAgentId: row.resolvedByAgentId,
  });
  const resolution = trimRequired('resolution', patch.resolution, INCIDENT_RESOLUTION_MAX);
  db.update('incidents', id, {
    resolvedAt: nowIso(), resolvedByAgentId: patch.resolvedByAgentId,
    resolution, resolutionTicketId: patch.ticketId ?? null,
  });
  return read(id);
}
```

Re-resolving is rejected outright (`wrong_status`) rather than silently overwritten or silently
ignored (idempotent no-op). Silent overwrite would let a second, less-informed caller erase a good
resolution note with no trace; silent no-op would let a caller believe its `ticketId`/`resolution` was
recorded when it was not. An explicit error surfaces the existing resolution in `details` so the
caller can decide (this mirrors `decisions.answer()`'s `wrong_status` shape exactly).

### D4 — `ac_incident_list`'s `status` defaults to `open`

`IncidentListQuery` gains `status?: 'open' | 'resolved' | 'all'`. `list()` adds `resolved_at IS NULL`
for `open`, `resolved_at IS NOT NULL` for `resolved`, and no extra condition for `all` **or when
`status` is left unset** — the service applies no default; unset means unfiltered, same as `all`.

The `open` default lives one layer up, in `ac_incident_list`'s Zod input schema
(`status: z.enum(INCIDENT_STATUS_FILTERS).default('open')`), not in the service. `list()` has a second
caller besides the tool: the session-authenticated `GET /api/incidents` route
(`packages/server/src/routes/daemon.ts`), which feeds the web app's global Incidents page and calls
`deps.incidents.list({ reporterKind, limit })` with no `status` at all. A service-level default would
silently apply there too — the human's page would stop showing resolved incidents, and with them the
`resolution` text, which is the most useful thing on a row someone already dealt with. That is a UI
change this ticket's Non-Goals rule out, and it would make the proposal's own "the HTTP routes are
unchanged" claim false. Putting the default in the tool schema instead means: the default is a
property of *the review sweep*, not of the data — `ac_incident_list` (the only caller with an
incremental-review use case) defaults to `open`, and every other `list()` caller, present or future,
keeps seeing everything unless it asks otherwise. This is the acceptance criterion the whole ticket is
about: "a second review pass over an already-reviewed, resolved set returns nothing new." `status:
'all'` and `status: 'resolved'` on the tool cover "there must be a way to see them" (the ticket's own
requirement #4).

### D5 — `ticketId` is stored, never validated, and resolution is never inferred

Two related decisions the ticket asked to be argued explicitly:

**Should a resolution's `ticketId` be checked against a real ticket?** No. The service layer that
resolves incidents (`packages/core/src/incidents/index.ts`) has no dependency on `TicketsService` today
and gaining one only to validate an optional free-form reference is not worth the coupling — a typo'd
or since-deleted ticket id should not block recording *why* an incident is resolved.

**Should landing a ticket that names an incident auto-resolve it?** No. The ticket's own text makes
the strongest case against this: "an incident is often fixed by work that never mentions it" — so
auto-resolution-on-ticket-landing would cover only the minority of cases where a ticket happens to
name the incident id, while doing nothing for the majority, creating an inconsistent expectation that
resolution "usually" happens automatically. It also asks the tickets subsystem to know about and
depend on the incidents subsystem (or vice versa) for a inference that would need its own
free-text-id-extraction heuristic — exactly the kind of coupling `incidents/resolution`'s "Resolution
is never inferred automatically" requirement rules out. A future change is free to add an *assistive*
prompt (e.g. surfacing "this ticket's description mentions incident X — resolve it too?") without
touching this requirement, since that keeps the call explicit.

## Risks / Trade-offs

- [`wrong_status` on re-resolve could surprise a caller re-running an idempotent-looking sweep] →
  The tool description states the guard plainly, and the error's `details` carries the existing
  resolution so the caller can move on rather than retry.
- [No FK on `resolution_ticket_id` means a resolved incident can point at a ticket id that never
  existed or was later deleted] → Accepted per D5; the field is documentation, not a join target.
- [Defaulting `ac_incident_list` to `open` is a behavior change for any existing caller that expected
  every incident] → No caller of the *tool* exists yet outside ad hoc conductor sweeps (this ticket's
  own origin story), and `status: 'all'` restores the old behavior in one parameter. The default is
  scoped to the tool's Zod schema, not the service, precisely so it cannot leak into `list()`'s other
  caller (`GET /api/incidents`, D4) — that route passes no `status` and keeps seeing every row.
- [A future direct caller of `IncidentsService.list()` that forgets to pass `status` gets everything,
  not the "hide resolved" behavior a naive reader might expect from this change] → Deliberate: the
  service's neutral default (unfiltered) is what a data-access layer should do; "hide what's dealt
  with" is a sweep's opinion, not the data's, so it lives where the opinion is (D4).

## Migration Plan

`packages/db/src/migrations/0028_incident_resolution.sql` adds the four columns; existing rows get
`resolved_at = NULL` (SQLite's implicit default for a nullable `ADD COLUMN`), so every incident filed
before this ships starts as `open` — correct, since none of them have been through the new `resolve`
path. No backfill needed. Deploy is the usual merge + `conductor daemon upgrade`; rollback is the
usual release rollback, and old code simply never reads the new columns.

## Handoff: the live routine's instruction (not part of this change's code)

Acceptance criterion 5 asks that captain's "Incident Resolution" routine be updated to use the new
verb instead of "clear," which has no meaning. That routine is a live row in the running workspace's
`routines` table, edited through `ac_routine_update` — a weaver-only MCP tool a worker's ticket has no
access to (`COMMON_TOOLS` does not include it), and CLAUDE.md's own house rule is explicit that a
worker delivers through the ticket while "the human runs `conductor daemon upgrade` after the merge;
that is the deploy step, and it is not yours." Applying this instruction update is the same kind of
post-merge step, owned by whoever holds the weaver session for this workspace.

Recommended replacement instruction text, to be applied via `ac_routine_update({ id: <routine id>,
instruction: <this text> })` once this change has merged and deployed:

> Look through incidents filed since your last bookmark (`ac_incident_list` with `since`, `status:
> "all"` so you re-check nothing you already resolved yourself — the default `open` filter already
> excludes those). For each one that is not transient: consider possible solutions, and file a ticket
> to fix the cause so it doesn't happen again. Then call `ac_incident_resolve` on it with a short
> `resolution` explaining what you found (and the ticket id, when you filed one, as `ticketId`).
> Bookmark the newest `createdAt` you processed for next time.

## Open Questions

None — the ticket named four explicit questions (states, who/what, inference, list default) and D1-D5
above answer each with a stated rationale.
