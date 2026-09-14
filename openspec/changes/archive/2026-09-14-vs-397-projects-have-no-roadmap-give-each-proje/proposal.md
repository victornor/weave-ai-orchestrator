## Why

Captain wants somewhere to park good feature ideas that are not ready to build. Today the only
durable place for an idea is a ticket, which carries a role, a workflow and a status the idea has
not earned; so ideas either become premature tickets or are forgotten. A per-project roadmap gives
each idea a home: captain says "put this on the roadmap" in chat, the weaver records it, and it
becomes a ticket only when captain decides to start it.

## What Changes

- **A new project-scoped entity, the roadmap item**, stored per workspace database: a title, markdown
  notes, a manual order, a status (`idea`, `planned`, `dropped`), an optional linked ticket set when
  work starts, who created it, and timestamps. A roadmap item belongs to exactly one project.
- **A migration (0040)** creating `roadmap_items` with a foreign key to its project, so a project
  removal can never leave an orphan item.
- **A core `RoadmapService` and HTTP API** — list, create, update (title, notes, status, order,
  linked ticket) and delete — scoped to a workspace and project, following the existing service and
  route patterns. `docs/API.md` gains a Roadmap subsection.
- **Four weaver tools** — `weave_roadmap_list`, `weave_roadmap_add`, `weave_roadmap_update`,
  `weave_roadmap_remove` — registered alongside the other `weave_*` tools. Writes are weaver-only;
  the list is readable by a worker for its own project.
- **Prompt and skill integration**: `templates/weaver.AGENTS.md.tmpl` and the `weave-ai-weaver` skill
  tell the weaver to park "remember this for later" / "put this on the roadmap" with
  `weave_roadmap_add` rather than filing a ticket, and to file a ticket and link it with
  `weave_roadmap_update` when captain says "let's start X".
- **A Roadmap section on the V2 project page**, added to `V2_PROJECT_SECTIONS`: items in order with
  title, status, notes and linked ticket, add/edit/reorder/change-status/delete in place, an empty
  state that explains what the roadmap is for, and live updates when the weaver changes it. V1 is
  unchanged.

## Capabilities

### New Capabilities

- `roadmap/storage`: the roadmap item entity — its fields, per-project scope, manual ordering, and
  the project-removal guarantee.
- `roadmap/http-api`: the workspace- and project-scoped HTTP routes for list, create, update
  (including reorder, status and ticket link) and delete, and how they are documented.
- `roadmap/weaver-tools`: the four `weave_roadmap_*` tools, their scoping (weaver-only writes, worker
  read of its own project) and their `{ ok, data | error }` envelope.
- `roadmap/project-page`: the V2 project page's Roadmap section and its live update.
- `agent-prompts/roadmap-intake`: the weaver's intake guidance and template/skill listing that route
  "remember this for later" to the roadmap and "let's start X" to a linked ticket.

### Modified Capabilities

- `web-v2/project-overview`: the overview's enumerated section list gains Roadmap.

## Impact

- `packages/shared/src/enums.ts` (`ROADMAP_STATUSES`), `packages/shared/src/events.ts`
  (`roadmap.created`/`updated`/`removed`), `packages/shared/src/tools.ts` (four tool names),
  `packages/db/src/migrations/0040_roadmap_items.sql`.
- `packages/core/src/roadmap/` (new service), `packages/core/src/api.ts`, `packages/core/src/create.ts`,
  `packages/ui/src/api/hooks.ts` and the V2 project section.
- `packages/server/src/routes/projects.ts` (routes), `packages/server/src/tools.ts` (handlers).
- `docs/API.md`, `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md`.
- No dependency or build change. No V1 surface. No sidebar, plugin, cross-project or workspace
  roadmap, dates or timelines.
