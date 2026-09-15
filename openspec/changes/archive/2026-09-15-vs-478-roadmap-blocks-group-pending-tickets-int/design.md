## Context

See `proposal.md` — Why. Ground truth as of this design, verified against the current worktree:

- The workspace database is migrated by `packages/db/src/db.ts` (`.sql` files sorted and applied
  once). The highest present number is `0042` (two files share it: `0042_run_last_progress.sql` and
  `0042_thread_message_replies.sql`), so this change uses **`0043`**.
- VS-397's roadmap lives in `packages/db/src/migrations/0040_roadmap_items.sql` (`roadmap_items`:
  `title`, `notes`, `position`, `status idea|planned|dropped`, `ticket_id`), with the core service at
  `packages/core/src/roadmap/index.ts`, routes at `packages/server/src/routes/projects.ts:136`, tools
  at `packages/server/src/tools.ts:991`, and specs under `openspec/specs/roadmap/`.
- `plan_drafts` (`0041`) is the closest precedent for a pre-ticket draft row: it already uses
  `target_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL`, `description TEXT NOT NULL DEFAULT ''`,
  a `kind` CHECK and a `priority` CHECK. The pending-ticket fields below reuse those names and the
  same `TICKET_KINDS`/`TICKET_PRIORITIES` value sets.
- `TERMINAL_TICKET_STATUSES = ['done', 'cancelled']` already exists (`packages/shared/src/enums.ts:33`);
  `weave_ticket_create` (`tools.ts:754`) takes `kind`, `priority`, `assigneeRoleId`, `description`,
  `title` — exactly the fields a pending ticket carries.
- The planning skill's merge-back rule (`skills/weave-ai-planning/SKILL.md:24`) is the rule the
  weaver applies when starting a block: two drafts with the same owner, no dependency between them
  and no separate review gate are one ticket.
- The V2 project page is `/w/$ws/p/$project` (`packages/ui/src/router.tsx`, `v2ProjectRoute`), its
  sections in `packages/ui/src/v2/project/sections.tsx`, and the rail's per-project rows in
  `packages/ui/src/v2/V2Shell.tsx` `WorkspaceGroups`. At phone width the rail is `hidden … md:flex`
  and projects appear nowhere except that rail, so the phone More list must gain them (VS-420's
  `MoreList` shows only `V2_WORKSPACE`/`V2_EVERYTHING`/`V2_KEPT`).
- Chat's draft store is `packages/ui/src/lib/drafts.ts` (keyed `<ws>.<thread>`), and `V2ChatPage`
  creates/uses the workspace's thread and holds the draft under the resolved thread id
  (`ChatPage.tsx:264-324`). There is no URL-param prefill and the chat route does not validate
  search, so a prefill has to survive until the thread id exists.

## Goals / Non-Goals

**Goals:** named ordered blocks of pending tickets per project; bundling by merge with a durable
record; starting a block into filing-ready drafts while ticket rules stay in `weave_ticket_create`;
a read-only Roadmap page per project with blocks, loose items and a working empty state; a Roadmap
sub-link under every project on desktop and phone; behavior specified and tested at every layer.

**Non-Goals:** drag-and-drop editing, auto-bundling without the weaver, cross-project blocks,
changing how real tickets/tiers/merges work, a V1 surface, editing blocks in the UI.

## Decisions

### Decision 1 — Loose items stay loose; a block is an explicit grouping

`roadmap_items` gains a nullable `block_id` (`REFERENCES roadmap_blocks(id) ON DELETE SET NULL`). An
item with no block is a **loose item** and keeps VS-397's exact behaviour (title, notes, status,
order, optional ticket link). The page shows blocks first, then a "Loose items" group.

- **Why, not a default block.** The ticket lets us pick loose-stays-loose or migrate into a default
  block. Loose-stays-loose is chosen because (a) the ticket's own page spec lists "the loose items"
  as a group separate from blocks, so loose items are expected to survive; (b) it needs no backfill
  and no invented block title captain never chose; (c) an existing idea's meaning is unchanged —
  VS-397 stored no block intent, so inferring one would be a guess. Migrating would also have to
  decide what "Loose" means when a project has several unrelated ideas.
- `ON DELETE SET NULL` because nothing in this change hard-deletes a block (see Decision 4); a
  future delete must not silently take ideas with it.

### Decision 2 — Migration `0043`, one block table and five item columns

`roadmap_blocks`: `id TEXT PK`, `project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE`,
`title TEXT NOT NULL`, `notes TEXT NOT NULL DEFAULT ''`, `position INTEGER NOT NULL`,
`status TEXT NOT NULL CHECK (status IN ('open','started','dropped')) DEFAULT 'open'`,
`started_at TEXT`, `created_by_kind TEXT NOT NULL`, `created_by_id TEXT`, `created_at TEXT NOT NULL`,
`updated_at TEXT NOT NULL`, with `CREATE INDEX roadmap_blocks_project_position ON
roadmap_blocks(project_id, position)`. The same cascade reasoning as `0040`: project removal is a
soft archive, so blocks survive it, and a hard delete takes them with it.

`roadmap_items` gains, additively:

- `block_id TEXT REFERENCES roadmap_blocks(id) ON DELETE SET NULL` (null = loose);
- `description TEXT NOT NULL DEFAULT ''` — the markdown ticket body, acceptance criteria included;
- `kind TEXT NOT NULL CHECK (kind IN ('change','task','scout','question','operational')) DEFAULT 'change'`;
- `priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium'`;
- `role_id TEXT REFERENCES roles(id) ON DELETE SET NULL` — the target role.

SQLite can add a nullable column and a column with a non-null default in place (`ALTER TABLE ADD
COLUMN`), and a `block_id` foreign key added this way is enforced once `PRAGMA foreign_keys` is on,
which the migration runner sets. `notes` is deliberately kept: it is the roadmap's own commentary,
while `description` is what the created ticket will carry. No data backfill: every existing row
keeps `title`/`notes`/`status`/`position` and reads as a loose item with default ticket fields.

`roadmap_item_merges`: `id TEXT PK`, `item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE
CASCADE` (the survivor), `source_item_id TEXT NOT NULL`, `source_title TEXT NOT NULL`,
`source_description TEXT NOT NULL DEFAULT ''`, `merged_by_kind TEXT NOT NULL`, `merged_by_id TEXT`,
`merged_at TEXT NOT NULL`, indexed on `(item_id)`. The source row is deleted by the merge, so its id
is stored as plain text (no FK) and its title/description are snapshotted — the record has to outlive
the row it came from. A JSON column was rejected: the repo keeps relations in tables.

### Decision 3 — Block status stores `open|started|dropped`; `done` is derived

The stored `status` is one of `open`, `started`, `dropped` (plus `started_at`). Every block the
service returns also carries an **effective** status: a `started` block with at least one item where
every item has a linked ticket and every one of those tickets is in `TERMINAL_TICKET_STATUSES`
(`done` or `cancelled`) reports `done`; otherwise the stored status is reported. `done` is never
written and is not settable through a tool.

- **Why derived.** The ticket says the block is `started` "and `done` once those tickets are
  terminal". Nothing in the daemon watches a block's tickets, so storing `done` would need a
  write-side watcher or the weaver to remember to close it; deriving it makes the acceptance ("reads
  `done` once those tickets are terminal") true the moment the last ticket closes, with no new
  background process. It also cannot drift from the tickets it describes.
- `cancelled` counts as terminal because the spec's word is terminal and a cancelled ticket is a
  settled one; a block whose tickets were all cancelled is finished, not still running.
- `_update` accepts `open`, `started` or `dropped` only; `dropped` is how a block is set aside (the
  ticket asks to "drop blocks", and this matches the item-level meaning of `dropped`). No hard-delete
  tool is added — it was not asked for.

### Decision 4 — The new tools are one family, weaver-only, and filing stays `weave_ticket_create`

Registered in `WEAVER_TOOLS` (`packages/shared/src/tools.ts`) and `packages/server/src/tools.ts`,
each returning `{ ok, data | error }`:

| Tool | Input | Returns |
|---|---|---|
| `weave_roadmap_block_create` | `{ projectId, title, notes? }` | the block, appended |
| `weave_roadmap_block_list` | `{ projectId }` | `{ blocks: [block with ordered items], loose: [items] }` |
| `weave_roadmap_block_update` | `{ blockId, title?, notes?, status?, position? }` | the block |
| `weave_roadmap_block_start` | `{ blockId }` | `{ block, drafts: [{ itemId, title, description, kind, priority, roleId }] }` |
| `weave_roadmap_item_add` | `{ blockId, title, description?, kind?, priority?, roleId?, notes? }` | the item, appended to the block |
| `weave_roadmap_item_update` | `{ itemId, title?, description?, kind?, priority?, roleId?, notes?, position?, blockId?, ticketId? }` | the item |
| `weave_roadmap_item_merge` | `{ itemIds }` (≥2) | the surviving item |

- **`start` returns drafts rather than filing.** The ticket is explicit that the weaver files with
  `weave_ticket_create` "so ticket rules, tiers and blockers stay in one place". `start` therefore
  sets `status='started'`, `started_at=now()`, and returns every item not yet linked to a ticket as
  a draft the weaver can pass straight to `weave_ticket_create` with the item's `roleId` as
  `assigneeRoleId`. Calling `start` on an already-started block is idempotent and returns the still
  unfiled drafts, so a partial filing can be retried; a `dropped` block is `validation`.
- **Linking uses `weave_roadmap_item_update { itemId, ticketId }`** — one write path for the link,
  and it already validates the ticket belongs to the project (the VS-397 rule).
- **Move between blocks** is `weave_roadmap_item_update { itemId, blockId }`, with `blockId: null`
  returning the item to loose. The target block must be in the same project.
- **Validation:** title non-empty (`validation`), `kind`/`priority` in their enum (`validation`),
  a named project/block/ticket/role that does not exist or belongs to another project (`not_found`),
  `blockId` naming a block of another project (`not_found`), and `start` on a `dropped` block
  (`validation`). The worker-readable `weave_roadmap_list` and the existing item tools are unchanged.
- **Why a new `block_*`/`item_*` family and not widening `weave_roadmap_add`:** the block shape and
  the ticket fields are a different input, and keeping VS-397's four tools stable means its specs,
  guidance and tests stay honest. Tool descriptions will carry the bundling intent, e.g. "one block
  becomes as few tickets as the work allows".

### Decision 5 — Merge combines into the first item and records the rest

`weave_roadmap_item_merge { itemIds }` keeps the **first** id as the survivor and merges the rest:

- all ids must be roadmap items of one project, at least two, and **none may already be linked to a
  ticket** (`validation`) — a filed ticket cannot be un-filed by a roadmap merge;
- the survivor keeps its title, block and status; the weaver can rename it afterwards;
- the survivor's description becomes its own description followed by each merged item's description
  under a `### Merged: <title>` heading, so acceptance criteria stay attributable;
- each merged item is written to `roadmap_item_merges` (source id, title, description snapshot) and
  then deleted; the project's item order is renumbered densely;
- the tool returns the survivor with its `merged` records so the weaver can confirm what it absorbed.

### Decision 6 — HTTP serves the read model the page needs; blocks are edited only through tools

Additive routes in `packages/server/src/routes/projects.ts` next to VS-397's:

- `GET /projects/:id/roadmap/blocks` → `{ blocks: [RoadmapBlock with ordered items] }`;
- `POST /projects/:id/roadmap/blocks` `{ title, notes? }` → **201** the block;
- `PATCH /projects/:id/roadmap/blocks/:blockId` `{ title?, notes?, status?, position? }` → the block.

The existing `GET /projects/:id/roadmap` is unchanged (all items, each now carrying `blockId`; the
page derives loose items from it). The existing item `PATCH` route additionally accepts
`description?`, `kind?`, `priority?`, `roleId?` and `blockId?` so the service has one write path;
the UI does not use them. An `:blockId` of another project is `not_found`. The page is **read-only**
(the ticket allows this): the weaver edits through the tools, so no block start/remove route exists.
`docs/API.md` gains the block routes and the new `RoadmapItem` fields.

### Decision 7 — Events: block kinds added, item changes reuse the roadmap kinds

`EVENT_TYPES` gains `roadmap.block.created`, `roadmap.block.updated` and `roadmap.block.removed`
(the service emits them with entity type `roadmap` and a payload carrying `projectId`). Item writes
keep emitting VS-397's `roadmap.created`/`roadmap.updated`/`roadmap.removed`. The UI's `TRACKED` list
and `invalidateFor` map all six to `qk.roadmapRoot(ws)`, `qk.roadmap(ws, projectId)` and a new
`qk.roadmapBlocks(ws, projectId)`, so a block created or started from chat appears on an open page
without a reload. A refetch is kept over cache patching because both lists are small and
order-sensitive.

### Decision 8 — The Roadmap page is a sibling of the project page

`packages/ui/src/v2/project/RoadmapPage.tsx`, routed at `p/$project/roadmap` as a sibling of
`v2ProjectRoute` (same slug-or-id resolution as `ProjectPage.tsx` via `resolveProject`), with a V2
header. It renders, in order: the project's blocks (each: title, notes, status tag, its pending
tickets with title, a kind tag and a priority tag, and a link to the created ticket when linked),
then the loose items (VS-397's rendering, read-only), then, when the project has neither, the empty
state. The project page's `RoadmapSection` gains a "Open the full roadmap" link to it and shows each
item's block when it has one.

### Decision 9 — The empty state seeds the chat composer

The empty state's button navigates to `/w/$ws/chat` and hands the prompt
`Tell me how roadmap blocks save tokens, and how to use them on this project.` to the composer. The
handoff is a one-shot seed in `packages/ui/src/lib/drafts.ts` (`seedDraft(ws, text)` /
`takeSeededDraft(ws)`, stored under a reserved `__seed__` thread segment); `V2ChatPage` consumes it
once its thread id is resolved and patches that thread's draft. Chosen over a `?prompt=` search param
because chat's route validates no search and the thread id does not exist until the page resolves
one; the seed survives thread creation and the prompt is editable before it is sent. `web-v2/chat`
gains one requirement for the behaviour; the seed store is tested purely.

### Decision 10 — The sidebar sub-link reuses one project-row component on desktop and phone

The rail's per-project row (`V2Shell.tsx` `WorkspaceGroups`) gains a secondary child row "Roadmap"
indented under the project, linking to `/w/<ws>/p/<slug>/roadmap`, with the project row highlighted
while its roadmap is shown (`activeNavKey`/the page maps `p/<slug>/roadmap` to `project:<slug>`). The
project row and its Roadmap child are extracted into one `ProjectRow` component used by the rail and
by a new **Projects** group in the phone `MoreList` (which today lists no projects at all), so the
phone gets the same sub-link. This is the smallest change that satisfies "on desktop and in mobile
nav" without a second navigation concept.

### Decision 11 — Weaver guidance and docs

`templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md` and
`packages/core/src/prompts/defaults.ts` (only if it repeats the text) gain: small related asks go
into a named block when captain names one or asks to batch, not straight to tickets; bundle related
items before filing so one worker does them in one ticket; starting a block files the minimum tickets
applying the planning skill's merge-back rule; and a short "how roadmaps save tokens" explanation the
weaver can give on request. `packages/shared/src/tools.test.ts`'s prose scan means every new
`weave_roadmap_*` token must be registered in the same change. `docs/PLAN.md` gains the block model,
start-a-block and the page under §6.1 and §21.1.

## Risks / Trade-offs

- **A read-derived `done` is not a stored fact.** A block reads `done` only while all its tickets are
  terminal; if a linked ticket were reopened the block would read `started` again — which is correct,
  and the alternative (a watcher) is more machinery than the behaviour needs.
- **`description` and `notes` on one row can be confused.** Guidance and the tool descriptions will
  say which is which; `notes` is roadmap commentary, `description` is the ticket body.
- **The phone project list lengthens the More sheet.** Projects are listed for the current workspace
  only, under their own group, matching the rail's scope.
- **Rendered check needs a running UI.** It runs on a source-built scratch daemon only (own config
  dir, loopback port other than 7433), captured dark/light at 1440 and dark at 390, with the
  captures kept uncommitted and their paths reported.

## Migration Plan

Additive only: one new table, one new record table, five `ALTER TABLE roadmap_items ADD COLUMN`
statements and one new index, no backfill and no table rebuild. Rollback is dropping the added
columns/tables; nothing else reads them. The daemon upgrade that ships it is the owner's
`weave daemon upgrade`, not this ticket's.

## Open Questions

None blocking. The ticket's one open choice (loose items vs a default block) is settled in
Decision 1, and the read-only UI is settled in Decision 6.
