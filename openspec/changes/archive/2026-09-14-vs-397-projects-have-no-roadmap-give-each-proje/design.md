## Context

See `proposal.md` — Why. Ground truth as of this design, verified against the current worktree:

- The workspace database is migrated by `packages/db/src/db.ts` (`MIGRATIONS_DIR`, `.sql` files read
  sorted and applied once each). The latest migration present is `0038_project_knowledge_switch.sql`;
  the ticket states `0039` is taken by VS-390 (#333, in the review queue), so this change uses
  **`0040`**.
- `projects` is defined at `packages/db/src/migrations/0001_init.sql:12`. Project removal is a
  **soft archive**: `packages/core/src/projects/index.ts:393` (`remove`) refuses while live workers
  exist, sets `status = 'archived'`, rewrites `workspace.yaml`, and leaves the row and clone in
  place. No core code hard-deletes a project row.
- The closest service/route analog is routines: `packages/core/src/routines/index.ts` (a service
  taking `WorkspaceContext`, using `newId`/`nowIso`, `OcError` validation, `ctx.events.emit`) and
  `packages/server/src/routes/routines.ts` (Zod-validated CRUD returning the row). Nested
  project-scoped routes already exist in `packages/server/src/routes/projects.ts` (`/:id/merge-queue`,
  `/:id/pull-requests`, `/:id/history`) and are mounted at `packages/server/src/app.ts:69`.
- Tool registration is a closed literal union (`packages/shared/src/tools.ts`: `COMMON_TOOLS`,
  `WEAVER_TOOLS`, `WORKER_ONLY_TOOLS`) matched to handlers in `packages/server/src/tools.ts`
  (`TOOLS`, with `runTool` enforcing scope at `tools.ts:1029`). `tools.test.ts:85-138` scans
  `skills/`, `templates/`, `docs/` and `packages/core/src/prompts/` and fails on any `weave_*` token
  that is not registered, so prose may only name a tool that is registered.
- `projectScope(ctx, projectId)` (`packages/server/src/tools.ts:142`) already implements exactly the
  worker restriction a roadmap read needs: a worker is pinned to `ctx.claims.projectId`, the weaver
  must name a project.
- Workspace events are a closed union (`packages/shared/src/events.ts:2`); the UI subscribes to a
  subset in `packages/ui/src/api/events.ts:163` (`TRACKED`) and maps each to query keys in
  `invalidateFor` (`events.ts:246`). Query keys live in `packages/ui/src/api/keys.ts`.
- The V2 project page renders whatever `V2_PROJECT_SECTIONS` lists
  (`packages/ui/src/v2/project/sections.tsx`, consumed by `ProjectPage.tsx`), and the interactive
  form/controls pattern already exists in `packages/ui/src/v2/scheduled/V2Scheduled.tsx` (field
  labels, `Button`, `EmptyState`, a small `inputCx` class).
- Intake guidance lives in `skills/weave-ai-weaver/SKILL.md` (the intake table, §"Intake") and
  `templates/weaver.AGENTS.md.tmpl` (the weaver's contract and its tool list).

## Goals / Non-Goals

**Goals:** one durable, ordered, per-project list of ideas, writable by the weaver from chat through
four `weave_roadmap_*` tools and editable in place on the V2 project page, kept current on the page
through the existing event stream; no orphan rows on project removal; behavior specified and tested
at every layer.

**Non-Goals:** sidebar entries, a plugin, cross-project or workspace roadmaps, dates or timelines, a
V1 surface, drag-and-drop ordering, per-item comments, or turning an idea into a ticket
automatically.

## Decisions

### Decision 1 — Storage: one `roadmap_items` table, migration `0040`, cascade on project

Columns: `id` (ULID PK), `project_id` (`NOT NULL REFERENCES projects(id) ON DELETE CASCADE`),
`title` (`NOT NULL`), `notes` (`NOT NULL DEFAULT ''`), `position` (`INTEGER NOT NULL`), `status`
(`NOT NULL CHECK (status IN ('idea','planned','dropped')) DEFAULT 'idea'`),
`ticket_id` (`REFERENCES tickets(id) ON DELETE SET NULL`), `created_by_kind`/`created_by_id`,
`created_at`, `updated_at`, plus an index on `(project_id, position)`.

- **Cascade, not archive, and why.** Project removal today is a soft archive that keeps the project
  row (`projects/index.ts:393`), so its roadmap items are never orphaned: they stay attached to the
  archived project. `ON DELETE CASCADE` is the belt-and-braces guarantee the ticket asks for — if a
  project row is ever hard-deleted, its items go with it rather than surviving with a dangling
  `project_id`. Nullable `project_id` (which would permit true orphans) and deleting items on
  archive (which would throw an idea away when a project is only paused) are both rejected.
- `ticket_id` is `ON DELETE SET NULL` for symmetry; no core path deletes a ticket, so this only
  guarantees a link can never outlive its ticket if one ever does.
- `created_by_kind`/`created_by_id` mirror `ticket_documents`' `author_kind`/`author_id` convention.

### Decision 2 — Status and ordering are shared, dense and hand-set

- `ROADMAP_STATUSES = ['idea','planned','dropped'] as const` is added to
  `packages/shared/src/enums.ts`, with a type and a Zod-at-the-boundary use in the routes — no raw
  status literals anywhere (house rule).
- `position` is dense and zero-based within a project. Create appends at `max(position)+1`; an
  update that sets `position` renumbers the project's items inside one `tx()` so the order stays
  dense and unique. Listing orders by `position, created_at, id`.
- Reorder is a single-item `position` on the existing `PATCH`, not a bulk reorder route: the V2 UI
  moves one item up or down, and one write path is easier to keep correct. A full-list `PUT` can be
  added later if drag-and-drop is ever wanted; nothing here blocks it.

### Decision 3 — HTTP routes nest under the project

`GET`/`POST /projects/:id/roadmap` and `PATCH`/`DELETE /projects/:id/roadmap/:itemId`, added to
`projectRoutes()` next to the project's existing nested routes, so the URL already carries the
project scope and the workspace is applied by the `/api/w/:ws` mount. An `:itemId` whose project is
not `:id` is `not_found`, so an id cannot be used to cross projects. Session-authenticated like every
other `/api/w/:ws` route; no run-token route beyond the agent tools.

### Decision 4 — Tools: read is common, writes are weaver-only

`weave_roadmap_list` goes in `COMMON_TOOLS`; `weave_roadmap_add`, `weave_roadmap_update` and
`weave_roadmap_remove` go in `WEAVER_TOOLS`.

- **Decision requested by the ticket — can workers read their own project's roadmap? Yes.** A worker
  already reads its own project's tickets and knowledge, and `projectScope()` (`tools.ts:142`)
  already implements the restriction: a worker is pinned to its run's project and naming another is
  `forbidden`. Making the read common costs nothing and lets a worker see what is planned around its
  work. Writes are weaver-only because a roadmap is captain's list, parked through the weaver; this
  is also what makes the "non-weaver write refused" acceptance test meaningful.
- Handlers use the same `svc(ctx).roadmap` service as the routes, so validation lives in one place;
  `runTool` already turns a thrown `OcError` into `{ ok: false, error }`.

### Decision 5 — Live updates ride the existing event stream

The service emits `roadmap.created`, `roadmap.updated` and `roadmap.removed` (entity type
`roadmap`, entity id the item id, payload carrying `projectId`). The three kinds are added to
`EVENT_TYPES`, to the UI's `TRACKED` list, and to `invalidateFor`, which invalidates
`qk.roadmapRoot(ws)` and `qk.roadmap(ws, projectId)` using the payload's `projectId`. A refetch is
chosen over patching the cached array (as some decision events do) because the list is small and
order-sensitive — a refetch always shows the true order, including reorders.

### Decision 6 — The V2 section is one more section under the shared contract

`roadmap` is added to `V2ProjectSectionKey` and to `V2_PROJECT_SECTIONS` (column `main`), with a
`RoadmapSection` body. It reads `useRoadmap(project.id)` and the roadmap mutations, renders items in
order with title, a status tag, markdown notes and the linked ticket link, and offers add, edit,
status change, move up/down and delete using the same `Button`/`EmptyState`/`inputCx` pattern
`V2Scheduled.tsx` uses. The section body may live in its own module (`RoadmapSection.tsx`) beside
`HistorySection.tsx`/`PullRequestsSection.tsx` if it grows; either way the page learns nothing new.

### Decision 7 — Prompt and skill changes are prose guarded by a test

`templates/weaver.AGENTS.md.tmpl` gains the roadmap tools in its tool list and a line in intake;
`skills/weave-ai-weaver/SKILL.md`'s intake table gains a "remember this / put it on the roadmap" row
and its tool list names the four tools. Because `tools.test.ts` rejects any unregistered `weave_*`
token in those files, the names must be registered in `packages/shared/src/tools.ts` in the same
change (as planned), which is also what makes the prose guard pass.

## Risks / Trade-offs

- **Position renumbering under concurrency.** Two simultaneous reorders could interleave; both writes
  run in one transaction each and SQLite serialises writers, and a roadmap is single-user, low
  volume. Accepted.
- **A worker reading the roadmap is a deliberate widening.** It adds one project-scoped read to the
  worker tool surface; it is scoped by the same helper as tickets and is read-only. If the weaver
  later wants ideas to stay private to captain, moving the tool to `WEAVER_TOOLS` is a one-line
  change plus a spec revision.
- **Rendered check needs a running UI.** Per the ticket it runs against a scratch daemon only, with
  screenshots captured dark/light, desktop/phone and empty; the four surfaces are compared against
  the surrounding V2 sections and any differences listed.

## Migration Plan

Additive only: a new table and a new enum, with no data backfill and no rebuild of an existing table.
Rollback is dropping the table; nothing else reads it. The daemon upgrade that ships it is the owner's
`weave daemon upgrade`, not this ticket's.

## Open Questions

None blocking. The ticket's one open decision (worker read) is settled in Decision 4.
