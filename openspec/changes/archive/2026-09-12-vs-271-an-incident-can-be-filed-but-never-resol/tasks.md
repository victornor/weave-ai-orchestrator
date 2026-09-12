# Tasks

- [x] 1. Migration `packages/db/src/migrations/0028_incident_resolution.sql`: plain `ALTER TABLE
      incidents ADD COLUMN` for `resolved_at TEXT`, `resolved_by_agent_id TEXT`, `resolution TEXT`,
      `resolution_ticket_id TEXT` (all nullable, no `CHECK`, no `-- ac:foreign_keys_off` needed).
- [x] 2. Shared: `Incident` (`packages/shared/src/types.ts`) gains `resolvedAt: string | null`,
      `resolvedByAgentId: string | null`, `resolution: string | null`, `resolutionTicketId: string |
      null`. Add `INCIDENT_STATUS_FILTERS = ['open', 'resolved', 'all'] as const` and
      `IncidentStatusFilter` to `packages/shared/src/enums.ts`. Add `'ac_incident_resolve'` to
      `WEAVER_TOOLS` in `packages/shared/src/tools.ts`.
- [x] 3. Core (`packages/core/src/incidents/index.ts`): add `INCIDENT_RESOLUTION_MAX = 2000`;
      `IncidentListQuery` gains `status?: IncidentStatusFilter`; `IncidentsService` gains
      `resolve(id, patch: { resolution: string; resolvedByAgentId: string; ticketId?: string | null
      }, scope?: IncidentGetScope): Incident`. `resolve()` reuses `read(id, scope)` for not_found/
      forbidden, throws `wrong_status` (with the existing resolution in `details`) when `resolvedAt`
      is already set, validates `resolution` with `trimRequired`, writes via `db.update`, returns
      `read(id)`. `list()`'s `WHERE` gains the status filter: `resolved_at IS NULL` for `open`,
      `resolved_at IS NOT NULL` for `resolved`, **no clause for `all` or for `status` left unset** —
      the service applies no default; only the tool (task 4) defaults to `open`.
- [x] 4. Tools (`packages/server/src/tools.ts`): register `ac_incident_resolve` (`id`, `resolution`,
      `ticketId?`) with `scope: 'weaver'`, calling `ctx.incidents.resolve(i.id, { resolution:
      i.resolution, resolvedByAgentId: ctx.claims.agentId, ticketId: i.ticketId ?? null }, {
      workspaceId: ctx.claims.workspaceId })`. `ac_incident_list`'s input gains `status:
      z.enum(INCIDENT_STATUS_FILTERS).default('open')` — **the default lives here, in the tool's Zod
      schema, not in `IncidentsService.list()`** — passed through to `ctx.incidents.list(...)`. Do
      **not** touch `packages/server/src/routes/daemon.ts`'s `GET /incidents` handler: it must keep
      calling `list({ reporterKind, limit })` with no `status`, which now means unfiltered.
- [x] 5. Core tests (`incidents.test.ts`): resolve happy path (fields recorded, returned row);
      re-resolve rejected `wrong_status` with the original resolution intact; not_found on unknown id;
      forbidden on another workspace's incident; empty/whitespace `resolution` rejected `validation`;
      `list()` with `status: 'open'`, `'resolved'`, `'all'`, **and with `status` omitted returns both**
      (proving the service itself has no default).
- [x] 6. Server tests (`packages/server/test/incidents.test.ts`): worker `ac_incident_resolve`
      rejected `forbidden` (incident stays unresolved) while filing still works; weaver resolve
      round-trips through `ac_incident_get`; `ticketId` stored unvalidated; the "second sweep finds
      nothing new" scenario end to end through the tool (list → resolve every item → list again with
      no `status` → empty, because the tool defaulted to `open` both times). Add a regression test
      that `GET /api/incidents` (session auth, `packages/server/test/*` wherever that route is already
      covered) still returns a resolved incident after this change — proving the tool-level default
      did not leak into the HTTP route.
- [x] 7. Shared test (`tools.test.ts`): `ac_incident_resolve` is in `WEAVER_TOOLS`, not in
      `COMMON_TOOLS`.
- [x] 8. Docs: `docs/PLAN.md` §9.2 and `docs/API.md`'s MCP section document `ac_incident_resolve` and
      `ac_incident_list`'s `status` filter and its `open` default, alongside the existing
      `ac_incident_list`/`ac_incident_get` line.
- [x] 9. Draft the corrected instruction text for captain's live "Incident Resolution" routine
      (already written in `design.md`'s Handoff section) so it is ready to quote verbatim in the
      delivery report. Applying it via `ac_routine_update` is a post-merge, weaver-only action outside
      a worker's tool access — call this out explicitly in the delivery report rather than marking it
      done.
- [x] 10. Green: `pnpm lint && pnpm typecheck && pnpm test` — post both suite blocks verbatim with
      their real totals.
