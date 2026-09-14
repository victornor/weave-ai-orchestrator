## 1. Shared foundations

- [x] 1.1 Add `ROADMAP_STATUSES = ['idea','planned','dropped'] as const` and its type to `packages/shared/src/enums.ts`; verify with an enums test asserting the three values in order and that `dropped` is distinct from a delete.
- [x] 1.2 Add `'roadmap.created'`, `'roadmap.updated'`, `'roadmap.removed'` to `EVENT_TYPES` (`packages/shared/src/events.ts`); verify `pnpm typecheck` passes and no exhaustive switch over `EventType` breaks.
- [x] 1.3 Add `weave_roadmap_list` to `COMMON_TOOLS` and `weave_roadmap_add`, `weave_roadmap_update`, `weave_roadmap_remove` to `WEAVER_TOOLS` (`packages/shared/src/tools.ts`); add `WEAVER_TOOLS`/`COMMON_TOOLS` assertions to `packages/shared/src/tools.test.ts` (list is common and readable, the three writes are weaver-only, none in `COMMON_TOOLS`).

## 2. Storage

- [x] 2.1 Add `packages/db/src/migrations/0040_roadmap_items.sql`: `roadmap_items` with `id` PK, `project_id` (`NOT NULL REFERENCES projects(id) ON DELETE CASCADE`), `title NOT NULL`, `notes NOT NULL DEFAULT ''`, `position INTEGER NOT NULL`, `status NOT NULL CHECK (status IN ('idea','planned','dropped')) DEFAULT 'idea'`, `ticket_id REFERENCES tickets(id) ON DELETE SET NULL`, `created_by_kind`, `created_by_id`, `created_at`, `updated_at`, and an index on `(project_id, position)`.
- [x] 2.2 Verify the migration applies on a fresh `Db.migrate()` and is recorded in `appliedMigrations`; verify with a test that deleting a `projects` row cascades to its `roadmap_items` rows (and that a soft archive does not).

## 3. Core service

- [x] 3.1 Add a `RoadmapService` interface to `packages/core/src/api.ts` (`list(projectId)`, `create(actor, projectId, input)`, `update(actor, itemId, patch)`, `remove(actor, itemId)`) and implement it in a new `packages/core/src/roadmap/index.ts`, following the routines service pattern (`ctx.db`, `newId`/`nowIso`, `OcError`, `ctx.events.emit`); wire it into `CoreServices` in `packages/core/src/create.ts`.
- [x] 3.2 Validate in the service: project exists (`not_found`), title non-empty (`validation`), status in `ROADMAP_STATUSES` (`validation`), a named `ticketId` exists and belongs to the item's project (`not_found`); an `itemId` not in the project is `not_found`.
- [x] 3.3 Dense ordering: create appends at the end of the project; an update setting `position` renumbers the project's items inside one `tx()` and keeps positions dense and unique; `list` orders by `position, created_at, id`.
- [x] 3.4 Emit `roadmap.created` / `roadmap.updated` / `roadmap.removed` with entity type `roadmap`, the item id, and a payload carrying `projectId`.
- [x] 3.5 Service tests (`packages/core/src/roadmap/roadmap.test.ts`): create/list round-trip, project scoping (another project's items absent), title/status validation, dense reorder (move last to first renumbers siblings), drop retains, delete removes, a linked ticket is stored and a foreign-project ticket is refused, and the events emitted for each write.

## 4. HTTP API

- [x] 4.1 Add roadmap routes to `packages/server/src/routes/projects.ts`: `GET`/`POST /:id/roadmap`, `PATCH`/`DELETE /:id/roadmap/:itemId`, with Zod request schemas; unknown project `not_found`, an item of another project `not_found`.
- [x] 4.2 Route tests: list is ordered and project-scoped, create returns 201 and appends, patch changes title/status/position/ticket, delete removes, and a cross-project item id is `not_found` for both patch and delete.
- [x] 4.3 Add a Roadmap subsection to `docs/API.md` under Projects documenting the routes, the `RoadmapItem` fields and the ordering/scoping rules.

## 5. Weaver tools

- [x] 5.1 Register the four handlers in `packages/server/src/tools.ts`: `weave_roadmap_list` uses `projectScope` (worker pinned to its own project, weaver names one); `weave_roadmap_add`/`_update`/`_remove` are `scope: 'weaver'` and delegate to `svc(ctx).roadmap`; each returns `{ ok, data | error }`.
- [x] 5.2 Tool tests: the weaver's add/list round-trip, `weave_roadmap_update` links a ticket, `weave_roadmap_list` returns the worker's own project's items and is refused (`forbidden`) for another project, and `weave_roadmap_add`/`_update`/`_remove` are refused (`forbidden`) to a worker with the roadmap unchanged.

## 6. Prompt and skill

- [x] 6.1 Add the four roadmap tools to the tool list in `templates/weaver.AGENTS.md.tmpl` and an intake line that "put it on the roadmap" / "remember this for later" is `weave_roadmap_add` (not a ticket), and "let's start X" files a ticket and links it with `weave_roadmap_update`.
- [x] 6.2 Add the matching intake-table row and tool names to `skills/weave-ai-weaver/SKILL.md`; verify `packages/shared/src/tools.test.ts`'s agent-facing-prose scan passes with the new names registered.

## 7. V2 UI

- [x] 7.1 Add `qk.roadmapRoot(ws)`/`qk.roadmap(ws, projectId)` (`packages/ui/src/api/keys.ts`) and `useRoadmap` plus create/patch/remove mutations (`packages/ui/src/api/hooks.ts`), invalidating the roadmap key on success.
- [x] 7.2 Add the three roadmap event kinds to `TRACKED` and to `invalidateFor` in `packages/ui/src/api/events.ts`, invalidating `qk.roadmapRoot(ws)` and `qk.roadmap(ws, payload.projectId)`; verify with an events test.
- [x] 7.3 Add a `RoadmapSection` body (in `packages/ui/src/v2/project/sections.tsx` or a sibling module) and add `roadmap` to `V2ProjectSectionKey` and `V2_PROJECT_SECTIONS` (column `main`): items in order with title, a status tag, markdown notes and the linked ticket link; add, edit title/notes, move up/down, change status, delete in place; an empty state explaining what the roadmap is for; V2 styling/components (`Button`, `EmptyState`, the `inputCx` pattern from `V2Scheduled.tsx`).
- [x] 7.4 Extend the V2 project test (`packages/ui/src/test/v2project.test.tsx`) plus a Roadmap section test: items render in order with status and linked ticket, the empty state renders, and add/edit/status/delete call the mutations and update the list; assert the mocked roadmap hook's values, not merely that a handler fired.

## 8. Verification

- [x] 8.1 Rendered check on a scratch daemon only (`scripts/scratch-daemon.sh`, explicit config dir, loopback port other than 7433, stopped only by its recorded PID): seed a project roadmap with several items in all three statuses, capture the V2 project page dark and light, desktop and phone width, and the empty state; compare the Roadmap section against the surrounding V2 project sections and list any differences in the report.
- [x] 8.2 Run `pnpm lint`, `pnpm typecheck` and both test suites; paste both suite blocks verbatim in the report (never merged, never one suite claimed as both).
- [x] 8.3 Run `openspec validate vs-397-projects-have-no-roadmap-give-each-proje --strict` and confirm clean.
