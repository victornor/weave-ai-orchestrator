## Why

VS-343 shipped the V2 shell, Mono theme and rail at `/v2`, with a placeholder page and header for
every destination but no screen content. This ticket fills two of them — **Settings** and
**Scheduled** — which are the two global screens that reach every setting an operator changes. The
settings the app has today are split across two routes (a daemon page and a per-workspace page) with
no way to see the relationship between them; the redesign makes one global screen with a scope row
and a section row, redesigns Models so the daemon default and the per-workspace override are visible
in one place, and restyles Scheduled as a list in the design's idiom. Without this ticket an
operator has no V2 surface for any setting, and V2 cannot be promoted.

## What Changes

- **Global Settings at `/v2/settings`**, with two tab levels: a scope row (`This daemon` plus each
  real workspace) and a section row that changes with it, plus one line stating what the current
  scope applies to. The daemon has no "applies to" control — it is the default for every workspace.
- **Daemon sections:** Updates (the key-value table, Check again / Upgrade, and the last upgrade's
  log), Models (redesigned), Security & devices, plus the V1 sections the design omits, kept and
  restyled: Host tools, Dictation, and Device & notifications.
- **Workspace sections:** the design's Weaver, Models, Projects and Knowledge, plus the kept V1
  sections restyled: YOLO and approval/delivery policy (as **Approvals**), Channels (Telegram token
  and pending approvals), and Presentation; each Projects row expands to landing branch, setup
  command, max workers and the kept per-project delivery/setup policies. **No Budget tab.**
- **Models, redesigned.** Runtime, model and thinking sit in one row per agent, with Weaver and
  Workers as two cards each carrying a note. Worker options are collapsed rows that expand to edit,
  with `+ Add option`. "When to use" is a real multiline field with a line saying the weaver reads
  it and nothing else.
- **Workspace overrides** for agents and worker options: an `inherited` / `overridden` tag,
  Override / Reset to daemon, an accent border when overridden and recessed controls when inherited,
  a footer naming the actual difference ("Overrides thinking high → max"), and a banner counting
  what is overridden. The option *list* stays the daemon's.
- **Read-only descriptions are not controls.** "Reviews every approval before you see it", "Let me
  override a held card", "Model tier default for new tickets" and the Knowledge curation rows
  ("weekly · Sunday 03:00", "over budget curate early") render as descriptions, not switches or
  selects.
- **Scheduled at `/v2/scheduled`**: the design's list with the scope (workspace · project) in the
  project's hue, plus V1's create, edit, pause and delete, its per-fire history and its 7d spend.
- **Frontend only.** No daemon, HTTP API, config or migration change. Every section reads and writes
  its real setting through the existing `packages/ui/src/api/**` hooks. V1 at `/` is untouched.

## Capabilities

### New Capabilities

- `web-v2/settings`: the global two-level Settings screen — the scope and section rows and the
  applies-to line; every daemon and workspace section reading and writing its real setting; the
  redesigned Models cards, worker options and "When to use"; workspace overrides with their diff and
  reset; read-only descriptions that are not controls; and the absence of a Budget tab.
- `web-v2/scheduled`: the global Scheduled screen — every workspace's routines as the design's list
  with the scope in the project's hue, and create, edit, pause and delete kept from V1.

### Modified Capabilities

_None. V2 is additive and V1's specified behaviour does not change. The V2 shell, navigation and
theme (VS-343) already give `/v2/settings` and `/v2/scheduled` a route, a header and a rail row;
this ticket fills their bodies and adds no route or nav entry._

## Impact

- **New:** `packages/ui/src/v2/settings/**` (the Settings screens, sections and the pure
  override/diff model), `packages/ui/src/v2/scheduled/**` (the Scheduled screen), and their tests
  under `packages/ui/src/test/`. New capabilities `openspec/specs/web-v2/settings/` and
  `openspec/specs/web-v2/scheduled/` (created on archive).
- **Modified:** `packages/ui/src/v2/pages.tsx` (the two page exports render the real screens instead
  of `V2Page` placeholders). `packages/ui/src/router.tsx` only if a route needs a search-param
  passthrough so the scope/section names survive a reload.
- **Reused, not forked:** `packages/ui/src/api/**` (client, hooks, workspace context), including
  `useWorkspaces`, `useDaemonModels`/`useSetDaemonModels`, `useModels`/`useSetModels`,
  `useRuntimes`/`useRuntimeModels`, `useDaemonUpdate`/`useDaemonUpgrade`, `useDaemonHostTools`,
  `useTranscription`, `useAuthSessions`/`useMe`, `useWorkspaceSummary`/`usePatchConfig`,
  `useProjects`/`usePatchProject`/`useAddProject`/`useMoveProject`/`useRemoveProject`, the Telegram
  token/pending hooks, `usePresentation`/`usePresentationSurfaces`/`usePutPresentation`, and the
  routine hooks (`useRoutinesMany`, `useCreateRoutineAt`, `usePatchRoutineAt`, `useRemoveRoutineAt`,
  `useRoutineFires`, `useRoutineUsageFor`). V1's `lib/settings.ts` table is reused where it fits.
- **Modified V1 code:** `packages/ui/src/routes/Settings.tsx` is not touched; the V2 screens reuse
  its existing hooks and lib helpers rather than importing its components.
- No HTTP route, MCP tool, CLI command, database migration, config field or daemon file changes.

## Open Questions

Resolved at plan review (2026-09-13): captain asked to **keep** V1's workspace Name / Ticket-prefix
editor (a workspace **General** section) and V1's read-only loaded-plugins list (a workspace
**Plugins** section), and to drop the theme buttons from This device in favour of the V2 rail
switch. A follow-up ticket, blocked on this one, adds real per-agent model inherit (PUT accepting
`null`, GET reporting each field's source); the value-based comparison stays isolated in
`v2/settings/override.ts` so that ticket can swap it.
