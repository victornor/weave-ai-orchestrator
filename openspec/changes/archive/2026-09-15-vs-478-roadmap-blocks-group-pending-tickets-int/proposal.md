## Why

Every small ask ("fix this button", "tidy that label") becomes its own ticket, and every ticket
spawns a fresh worker that re-learns the project — a large, avoidable token cost. VS-397 gave each
project a flat roadmap of loose ideas; what is missing is a way to collect related asks into a
**named block**, bundle them into as few tickets as the work allows, and start the whole block at
once. This change grows the roadmap into that shape and gives each project a real Roadmap page with
a sidebar entry, so captain can see and steer a block before any worker is spawned.

## What Changes

- **Roadmap blocks and pending tickets (data + core).** A project's roadmap gains ordered, named
  **blocks** (`open | started | done | dropped`, with `done` derived once every linked ticket is
  terminal) holding ordered **pending tickets** — roadmap items carrying the fields a real ticket
  needs (`title`, `description`, `kind`, `priority`, a target role). Existing loose items keep
  working unchanged as unblocked items shown separately on the page. A migration (`0043`) adds the
  block table, the new item columns and the merge record.
- **Bundling.** Two or more pending tickets in one project can be **merged** into one, combining
  their descriptions and acceptance criteria and recording what was merged, so one worker does the
  related work in one ticket.
- **Weaver tools** (weaver-scope, extending the `weave_roadmap_*` family): create, list, update and
  reorder blocks; add, update, move and merge pending tickets; and **start a block**, which returns
  its unfiled pending tickets as filing-ready drafts so the weaver can create the real tickets with
  `weave_ticket_create` (rules, tiers and blockers stay in one place) and link each item back. Tool
  descriptions state the bundling intent.
- **Weaver guidance.** `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md` and any
  matching text in `packages/core/src/prompts/defaults.ts` tell the weaver to park small related
  asks in a named block instead of filing one ticket each, to bundle before filing, and how roadmaps
  save tokens.
- **A Roadmap page.** A full read-only page per project at `/w/<ws>/p/<project>/roadmap`: the
  blocks in order with their pending tickets (title, kind, priority), status and links to created
  tickets; the loose items; and an empty state ("No roadmap yet. Ask the weaver about roadmaps") with
  a button that opens the chat with that prompt prefilled. The project page's Roadmap section links
  to it.
- **Sidebar.** Under each project in the V2 rail, a small secondary **Roadmap** child link to that
  project's roadmap page, and the same under each project in the phone More list.
- **Specs and docs.** The roadmap capability specs gain blocks, the page, the tools and the
  navigation entry; `docs/API.md` documents the block routes and new item fields; `docs/PLAN.md`
  records the block model, start-a-block and the page.

## Capabilities

### New Capabilities

- `roadmap/blocks`: the named block entity — its fields, per-project ordering, its `open`/`started`/
  `done`/`dropped` lifecycle with `done` derived from its tickets, the pending-ticket items it holds,
  the bundling merge and its record, and starting a block into filing-ready drafts.
- `roadmap/roadmap-page`: the full read-only per-project Roadmap page at
  `/w/<ws>/p/<project>/roadmap` — blocks with their pending tickets and ticket links, loose items,
  and the empty state that opens the chat with a prefilled prompt.

### Modified Capabilities

- `roadmap/storage`: the item record gains an optional block, a description, a kind, a priority and
  a target role, plus the merge record; existing loose items stay valid after the migration.
- `roadmap/http-api`: block routes (list, create, update) and the additive new item fields on the
  existing item routes; the block routes are documented.
- `roadmap/weaver-tools`: the new `weave_roadmap_block_*` and `weave_roadmap_item_*` tools, their
  weaver-only scope and validation, and the bundling intent in their descriptions.
- `roadmap/project-page`: the Roadmap section shows blocks and links to the full page.
- `agent-prompts/roadmap-intake`: the weaver's intake and prompting guidance for blocks, bundling,
  starting a block and how roadmaps save tokens.
- `web-v2/navigation`: each project row in the rail and phone More list gains a Roadmap sub-link.
- `web-v2/shell`: the project Roadmap page is an addressable V2 destination with a header.
- `web-v2/chat`: chat consumes a one-shot seeded prompt so an empty roadmap can hand it a question.

## Impact

- `packages/db/src/migrations/0043_roadmap_blocks.sql` (new), `packages/db/src/migrations.test.ts`.
- `packages/shared/src/enums.ts` (block statuses, derived done; maybe terminal-ticket reuse),
  `packages/shared/src/events.ts` (block event types), `packages/shared/src/tools.ts` (new tool
  names), `packages/shared/src/types.ts` (block and extended item types).
- `packages/core/src/roadmap/` (blocks, items, merge, start), `packages/core/src/api.ts`.
- `packages/server/src/routes/projects.ts`, `packages/server/src/tools.ts`.
- `packages/ui/src/api/{hooks,keys,events}.ts`, `packages/ui/src/v2/project/` (Roadmap page + section
  link), `packages/ui/src/v2/V2Shell.tsx` + `nav.ts`, `packages/ui/src/router.tsx`,
  `packages/ui/src/lib/drafts.ts` and `packages/ui/src/v2/ChatPage.tsx` (the prefilled prompt).
- `docs/API.md`, `docs/PLAN.md`, `templates/weaver.AGENTS.md.tmpl`,
  `skills/weave-ai-weaver/SKILL.md`, `packages/core/src/prompts/defaults.ts`.
- No dependency or build change. No V1 surface. No cross-project blocks, no drag-and-drop editing,
  no auto-bundling without the weaver.
