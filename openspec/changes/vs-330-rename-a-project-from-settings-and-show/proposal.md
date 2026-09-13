## Why

Captain's project is now called Weave AI, but every screen still labels it `agent-conductor`: the
API already stores a project `name` (`ProjectConfigSchema.name`, written by `projects.update`), yet
Settings has no field to set it and the UI labels projects by `slug` in roughly fifty places. The
owner cannot make a project read as the thing they call it.

## What Changes

- Settings' Projects section gains an editable **display name** on each active project row, using
  the existing `useCommittableField` / `CommitStatus` pattern. It PATCHes `name`, applies live, and
  commits only `name`. An empty value clears the name and falls back to the slug.
- One shared label rule — a project's label is its `name` with surrounding whitespace trimmed when
  that is non-empty, otherwise its `slug` — applied wherever a person reads a project label across
  the web app: the sidebar and phone More menu, the board's project filter and cards, the ticket
  and worker pages, Team, Merge queue, Knowledge, Usage, the Map, the chat's project tags and
  pickers, dispatch/decision labels, and the Settings rows themselves.
- The slug is kept wherever it identifies a project — route params, the project-overview address,
  `[[links]]` and knowledge paths, CLI arguments, move/remove identity and clash checks — optionally
  as secondary mono text beside the label, never in place of it.
- The daemon's own human-facing text uses the label too: the weaver's rendered project list (so an
  unset name no longer renders a blank), and decision titles, changelog entries and ticket titles
  that name a project.
- A rename is reflected without a reload: `project.updated` is already emitted; the UI's project
  query invalidation on that event is confirmed and covered by a test.
- Clearing is the empty-string sentinel, matching `landingBranch`: the stored name becomes empty,
  reads as "no name", and every reader falls back to the slug.

## Capabilities

### New Capabilities
- `project-naming`: the one rule for a project's display label, every surface a person or the weaver
  reads it through, and the places the slug must stay because it is an identifier.
- `web-settings/project-name`: reading and changing a project's display name from the Settings
  Projects section, including clearing it back to the slug.

### Modified Capabilities
- `workspace-navigation/sidebar-workspaces`: a project row in the sidebar and in the phone More menu
  is named by the project's display label instead of its slug.
- `workspace-navigation/global-map`: a project node is named with the project's display label
  instead of its slug.
- `workspace-navigation/project-colour`: the identifying text a project's colour is applied to is
  the project's display label.

## Impact

- `packages/shared` — a pure `projectLabel` helper, beside the existing `landingBranchOf`.
- `packages/core` — `projects.update` clearing semantics for `name`; the weaver project list and
  role lines in `prompts/index.ts`; the human-facing project names in `roles/index.ts`,
  `changelog/index.ts`, `workers/index.ts` and `threads/service.ts`.
- `packages/ui` — the Settings project row, the ~40 label sites, the knowledge surfaces that hold a
  `projectId` (resolved to a label through the project list the app already loads), and the map
  model. `projectColor`, routing and move/remove identity are unchanged.
- `packages/server` — no new route. `docs/API.md` gains the already-accepted `name` on the project
  POST/PATCH bodies.
- Tests: `packages/core/src/projects/projects.test.ts`, `packages/core/src/prompts/render.test.ts`,
  and the UI suite (`settings`, `events`, `workspacenav`, `moreSheet`, `board`, `ticketPage`,
  `team`, `mergeQueue`, `workerPage`, `mapModel`, `globalMap`).
