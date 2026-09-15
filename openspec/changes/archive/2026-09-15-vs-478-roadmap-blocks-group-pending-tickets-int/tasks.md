## 1. Shared foundations

- [x] 1.1 In `packages/shared/src/enums.ts` add the block status tuple and type: stored `ROADMAP_BLOCK_STATUSES = ['open','started','dropped'] as const` plus the reported shape that includes `done` (e.g. `RoadmapBlockStatus` and a `roadmapBlockStatus(stored, items, tickets)` helper), with a unit test asserting the stored triple, that `done` is reported for a started block whose every linked ticket is terminal, and that it is not settable.
- [x] 1.2 In `packages/shared/src/events.ts` add `'roadmap.block.created'`, `'roadmap.block.updated'`, `'roadmap.block.removed'` to `EVENT_TYPES`; verify `pnpm typecheck` passes and no exhaustive switch over `EventType` breaks.
- [x] 1.3 In `packages/shared/src/tools.ts` add the seven new `weave_roadmap_block_*`/`weave_roadmap_item_*` names to `WEAVER_TOOLS`; extend `packages/shared/src/tools.test.ts` to assert each is weaver-only and absent from `COMMON_TOOLS`.
- [x] 1.4 In `packages/shared/src/types.ts` add `RoadmapBlock` (id, workspaceId, projectId, title, notes, position, stored status, reported status, startedAt, createdByKind/id, createdAt, updatedAt, items) and the added `RoadmapItem` fields (`blockId`, `description`, `kind`, `priority`, `roleId`); add a `RoadmapMergeRecord` type.

## 2. Storage

- [x] 2.1 Add `packages/db/src/migrations/0043_roadmap_blocks.sql`: `roadmap_blocks` (id, project_id `ON DELETE CASCADE`, title, notes default '', position, status CHECK `open|started|dropped` default `open`, started_at, created_by_kind, created_by_id, created_at, updated_at) with the `(project_id, position)` index; `ALTER TABLE roadmap_items ADD COLUMN` for `block_id` (`REFERENCES roadmap_blocks(id) ON DELETE SET NULL`), `description` default '', `kind` CHECK the ticket kinds default `change`, `priority` CHECK the ticket priorities default `medium`, `role_id` (`REFERENCES roles(id) ON DELETE SET NULL`); and `roadmap_item_merges` (id, item_id `ON DELETE CASCADE`, source_item_id, source_title, source_description, merged_by_kind/id, merged_at) with its `item_id` index.
- [x] 2.2 Verify in `packages/db/src/migrations.test.ts`: the migration applies on a fresh `Db.migrate()` and is recorded; a `roadmap_items` row inserted before `0043` still reads with its title/notes/status/position unchanged and the field defaults; deleting a `projects` row cascades to its blocks; deleting a block sets its items loose rather than deleting them; deleting a survivor deletes its merge records.

## 3. Core service

- [x] 3.1 Extend the `RoadmapService` interface in `packages/core/src/api.ts` with the block methods (`createBlock`, `listBlocks`, `updateBlock`, `startBlock`), the item methods (`addItem`, `updateItem` extended with the new fields, `moveItem` folded into `updateItem`, `mergeItems`) and a `getBlock`; implement in `packages/core/src/roadmap/index.ts` following the VS-397 patterns (`tx()`, `newId`/`nowIso`, `OcError`, `ctx.events.emit`).
- [x] 3.2 Validate: project/block/ticket/role existence and same-project membership (`not_found`), non-empty title, `kind`/`priority`/block-status enums and a `dropped`-block start (`validation`), merge of fewer than two items, cross-project items, or any item already linked (`validation`).
- [x] 3.3 Dense ordering: block create appends and a block `position` renumbers the project's blocks; item add appends within its block and an item `position` renumbers the project's items; a move between blocks places the item at the end of its new group; `listBlocks` orders blocks by `position, created_at, id` and each block's items by `position, created_at, id`.
- [x] 3.4 Merge: keep the first item, append each merged item's description under a `### Merged: <title>` heading, write a `roadmap_item_merges` record per merged item, delete the merged rows, renumber, and return the survivor with its merge records.
- [x] 3.5 Start: set `status='started'` and `started_at`, return drafts for items with no linked ticket as `{ itemId, title, description, kind, priority, roleId }`, idempotent on a started block, `validation` on a dropped one; report the derived `done` status in `getBlock`/`listBlocks`.
- [x] 3.6 Emit `roadmap.block.created`/`updated`/`removed` for block writes with entity type `roadmap` and a payload carrying `projectId`, and keep VS-397's `roadmap.*` events for item writes.
- [x] 3.7 Service tests in `packages/core/src/roadmap/roadmap.test.ts`: create a block, add three pending tickets, merge two into one and move one to a second block, then `listBlocks` shows the blocks with their items in order; start returns filing-ready drafts; after linking tickets the block reads `started`, and `done` once they are terminal; a pre-existing loose item still lists; the field and merge validations above.

## 4. HTTP API

- [x] 4.1 Add block routes to `packages/server/src/routes/projects.ts`: `GET`/`POST /:id/roadmap/blocks` and `PATCH /:id/roadmap/blocks/:blockId`, with Zod schemas; unknown project or block `not_found`; a block of another project `not_found`.
- [x] 4.2 Extend the existing item `PATCH` schema with the new optional `description?`, `kind?`, `priority?`, `roleId?` and `blockId?` fields, leaving `GET /:id/roadmap`'s shape unchanged.
- [x] 4.3 Route tests: blocks list in order with their items and are project-scoped; create returns 201; patch changes title/status/position; a cross-project block id is `not_found`; the item patch round-trips the new fields.
- [x] 4.4 Add the block routes, the `RoadmapBlock` fields, the derived `done` status and the new `RoadmapItem` fields to the Roadmap subsection of `docs/API.md`.

## 5. Weaver tools

- [x] 5.1 Register the seven handlers in `packages/server/src/tools.ts`, all `scope: 'weaver'`, delegating to `svc(ctx).roadmap`, returning `{ ok, data | error }`; descriptions state the bundling intent and that `block_start` returns drafts for `weave_ticket_create`.
- [x] 5.2 Tool tests in `packages/server/test/roadmapTools.test.ts`: the block create/add/merge/move/list acceptance from the ticket; `block_start` returns filing-ready drafts; `weave_roadmap_item_update` links a ticket; every new tool is refused `forbidden` to a worker with the roadmap unchanged.

## 6. Prompt and skill

- [x] 6.1 Update `templates/weaver.AGENTS.md.tmpl`: the Roadmap line names the new tools, says small related asks go into a named block when captain names one or asks to batch, that starting a block files the minimum tickets after merging, and adds the short "how roadmaps save tokens" explanation.
- [x] 6.2 Update `skills/weave-ai-weaver/SKILL.md` with the matching intake row and tool list; update `packages/core/src/prompts/defaults.ts` only where it repeats the same text.
- [x] 6.3 Add or extend a prompt/skill render test that asserts the block, bundling and start guidance and the new tool names appear, and that `packages/shared/src/tools.test.ts`'s prose scan passes.

## 7. V2 UI

- [x] 7.1 Add `qk.roadmapBlocks(ws, projectId)` (`packages/ui/src/api/keys.ts`), `useRoadmapBlocks` (`packages/ui/src/api/hooks.ts`) and the block event kinds to `TRACKED`/`invalidateFor` (`packages/ui/src/api/events.ts`), invalidating the roadmap and roadmap-blocks keys; extend the events test.
- [x] 7.2 Add `packages/ui/src/v2/project/RoadmapPage.tsx` routed at `p/$project/roadmap` in `packages/ui/src/router.tsx` and exported from `packages/ui/src/v2/pages.tsx`: blocks in order with title, status, notes, and their pending tickets (title, kind, priority, ticket link), then loose items, then the empty state; read-only.
- [x] 7.3 Implement the empty state's action with the one-shot seed in `packages/ui/src/lib/drafts.ts` (`seedDraft`/`takeSeededDraft`) and its consumption in `packages/ui/src/v2/ChatPage.tsx`; test the seed store purely and its one-shot, per-workspace behaviour.
- [x] 7.4 Add the "Open the full roadmap" link and the block title to `RoadmapSection` (`packages/ui/src/v2/project/RoadmapSection.tsx`).
- [x] 7.5 Add the Roadmap child row under each project in `V2Shell.tsx` (extracting a shared `ProjectRow`), highlight the project row for the roadmap route, and list projects with the child row in the phone `MoreList`; update the `nav.ts` active-key rule if needed.
- [x] 7.6 UI tests (`packages/ui/src/test/v2project.test.tsx` or a sibling): blocks and their pending tickets render in order from mocked hooks with kind, priority and ticket links; the empty state renders and its action seeds the chat; the rail and More list show the project Roadmap sub-link and it points at the project's roadmap address.

## 8. Docs and specs

- [x] 8.1 Add the block model, start-a-block and the Roadmap page to `docs/PLAN.md` (§6.1 entities and §21.1 V2 destinations).
- [x] 8.2 Run `openspec validate vs-478-roadmap-blocks-group-pending-tickets-int --strict` and confirm clean.

## 9. Verification

- [x] 9.1 Rendered check on a source-built scratch daemon only (`scripts/scratch-daemon.sh`, explicit config dir, loopback port other than 7433, stopped only by its recorded PID, never the live daemon or 7433): seed a project with two blocks (one started with linked tickets) and some loose items, capture the Roadmap page dark and light at 1440 and dark at 390, capture the empty state, and capture the sidebar Roadmap sub-link on desktop and in the phone More list; keep the captures uncommitted outside the worktree and report their paths.
- [x] 9.2 Run `pnpm lint`, `pnpm typecheck` and both test suites; paste both suite blocks verbatim in the report (never merged, never one suite claimed as both).
- [x] 9.3 Confirm `git status --porcelain` in the worktree is empty before requesting review, and that no GitHub-hosted Actions run was triggered.
