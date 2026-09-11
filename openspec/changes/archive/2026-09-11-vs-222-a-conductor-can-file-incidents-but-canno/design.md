# Design: conductor incident reads

## Context

`IncidentsService` (`packages/core/src/incidents/index.ts`) already has `get(id)` and `list(query)`, and `GET /api/incidents[/:id]` serves them to a session. The MCP surface (`packages/server/src/tools.ts`) only registers `ac_incident` (create). `IncidentListQuery` is `{ reporterKind?, limit? }`; `list()` runs `SELECT * FROM incidents [WHERE reporter_kind = ?] ORDER BY created_at DESC, id DESC LIMIT ?` with **no workspace filter** — the table is daemon-global (`daemon.sqlite`), and `workspace_id` is nullable. Timestamps are `nowIso()` = `new Date().toISOString()` (always ms-precision `...sssZ`), so lexicographic comparison in SQL is exact once the bound is normalized to the same format.

## Goals / Non-Goals

Goals: conductor-only MCP reads (list + get) over the existing service; explicit workspace scoping; a `since` time bound that supports an incremental daily sweep; tests for each acceptance criterion.

Non-Goals: no resolution/acknowledged/triage state on incidents (filed separately if wanted); no worker read access; no change to `ac_incident`, the HTTP routes or their auth; no redaction pipeline for `evidence`; no CLI command and no UI change.

## Decisions

### D1 — Scope to the caller's workspace, plus workspace-less rows

The list filters `workspace_id = <caller's> OR workspace_id IS NULL`; `get` applies the same rule and throws `OcError('forbidden')` on a row from another workspace. The workspace comes from `ctx.claims.workspaceId`, never an input; a run with no workspace id is a `validation` error.

Why: the rest of the system holds a hard boundary that a conductor sees only its own workspace (tickets, KB, specs all enforce it). An unfiltered list would hand every conductor every workspace's `evidence`/`tryingToDo` — free text written by agents working on someone else's project. The counter-argument (system health is global) is preserved exactly where it is real: rows with **no** workspace binding are daemon-global by construction, carry no workspace's data, and stay visible to every conductor so a routine sweeping "the daemon's" incidents does not silently miss unscoped ones. The human keeps the daemon-wide view through the unchanged session-auth routes. Alternative considered: strictly `workspace_id = caller`, hiding null-workspace rows from conductors — rejected because it makes the only agent-visible slice *smaller* than the global truth for no isolation gain, and because today every incident has a workspace (null rows would be an invisible corner nothing reads).

### D2 — `since` is exclusive, normalized, and lives in the service

`IncidentListQuery` gains `since?: string` and `workspaceId?: string`. The service parses `since` with `new Date()` (`validation` on unparseable/invalid), normalizes with `.toISOString()`, and filters `created_at > ?` — strictly after. Exclusive because the intended caller bookmarks the newest `createdAt` it processed; every row sharing that timestamp was already returned in the same page (ordered `created_at DESC, id DESC`), so `>` neither repeats nor skips. Normalization matters: `2026-09-11T00:00:00Z` (no ms) sorts *after* `2026-09-11T00:00:00.123Z` as a raw string, so a naive compare would silently exclude a whole second. Both sides are normalized to `toISOString()` format before comparing. A full page (`items.length === limit`) may still have more behind it — the routine pages until short before bookmarking; that guidance goes in the tool description. Alternative considered: inclusive `>=` — rejected: it re-delivers the boundary row every sweep, which is precisely the "re-reads the same incidents forever" failure the ticket calls out.

The scoping and time bound live in the service, not the tool handler, so `total` counts the same filtered set the page draws from and any future caller (routine service) inherits the semantics. The HTTP routes simply don't pass the new fields and are untouched.

### D3 — Lean list with `includeEvidence`, and the 64 KiB cap

`ac_incident_list` returns rows without `evidence` unless `includeEvidence: true`; `ac_incident_get` always returns the full row. Evidence is bounded (≤ 8 000 chars) but is the bulk of a row, and the whole point of the tool is triaging many rows at once. This mirrors the `agent-tools/lean-lists` pattern (`ac_ticket_list` / `includeDescription`) including its "get returns the body" counterpart. `ac_incident_list` is added to `LIST_TOOLS` in `mcp.ts` so the existing 64 KiB cap applies with `truncated: true`. Alternative considered: always-full rows — rejected: at worst ~1.2 MB for a default page, guaranteeing `truncated: true` exactly when a sweep has the most to read.

### D4 — Conductor-only via `CONDUCTOR_TOOLS`

The two names go into `CONDUCTOR_TOOLS` (packages/shared) with `scope: 'conductor'` on the `ToolDef`. `runTool` already rejects any name outside `toolNamesFor(agentKind)` with `forbidden`, which is the worker-rejection the ticket requires — no new enforcement code. Workers keep `ac_incident` (it is in `COMMON_TOOLS`) and gain nothing else.

### D5 — Evidence content: rely on the existing norm, now scoped

`evidence` is agent-written free text and stays unredacted. The create tool's description already forbids secrets there; that norm is relied on. The read path adds no new exposure beyond what a session (the human) can already read, and D1 bounds what any conductor sees to its own workspace. Stated deliberately: no transformation is done on read.

## Risks / Trade-offs

- [Null-workspace rows are visible to every conductor] → They carry no workspace binding, and the spec pins this reading so it stays deliberate. If real null-workspace rows with sensitive content ever appear, tighten D1.
- [`total` on a scoped list may surprise callers expecting the daemon-wide count] → The spec states `total` counts the visible set; the tool description repeats it.
- [Incidents created in the same millisecond as a bookmark straddle pages] → `id DESC` tiebreak plus page-until-short guidance in the tool description; incident volume makes this theoretical.
- [`LIST_TOOLS` membership changes MCP encoding for the new tool only] → `capListResult` is generic and already covered by mcp tests.

## Migration Plan

No migration: text columns and existing indexes (`incidents_created_at`, `incidents_reporter_kind`) already serve the new filters. Deploy is the usual merge + `conductor daemon upgrade`. Rollback is the usual release rollback; the new columns-free query params degrade to unused fields on old readers.

## Open Questions

None — D1/D2 are the two decisions the ticket named, decided above with rationale.
