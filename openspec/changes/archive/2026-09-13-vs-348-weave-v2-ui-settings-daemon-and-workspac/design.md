## Context

Ground truth verified against `origin/main` at `d8d3c852` (VS-343, the V2 shell), before this
change:

- **The V2 shell already routes both screens.** `packages/ui/src/router.tsx:177` registers
  `v2SettingsRoute = v2GlobalRoute('/settings', 'V2SettingsPage')` and
  `:173` `v2ScheduledRoute = v2GlobalRoute('/scheduled', 'V2ScheduledPage')`; the pages are
  placeholders in `packages/ui/src/v2/pages.tsx` (`V2SettingsPage` line 31,
  `V2ScheduledPage` line 28). Both are global (not under `/v2/w/$ws`), both already highlight a rail
  row via `activeNavKey` (`packages/ui/src/v2/nav.ts:124-127`), and `docs/design/v2/` holds the
  reference (HANDOFF §9 at lines 166-195, the Settings screen at `Screens.dc.html:1143-1424`, the
  Scheduled screen at `:1122-1141`).
- **`V2Page`** (`packages/ui/src/v2/V2Page.tsx:65`) is the frame: a 38px header with crumb root,
  title, optional subtitle and live/needs count pills, over a scrollable body. `V2Page` already
  derives `scope` from the path (`useV2Scope`, line 10), which is `everywhere` for both screens.
- **V2 token classes** (`packages/ui/src/v2/v2.css`): `.v2-card` (line 165), `.v2-tag` (152),
  `.v2-recessed` (173), `.v2-row` (179), `.v2-link` (140); V2 repaints V1's `ac-*` classes because
  it overrides the underlying `--bg-*`/`--text-*`/`--line-*` tokens under `.v2-root`. There are no
  V2 component primitives; screens reuse V1 `components/Button`, `components/Tabs` and
  `components/States`/`Skeleton` and use raw utilities elsewhere.
- **V1 settings is two routes with one shared sections table.** `DaemonSettingsRoute`
  (`packages/ui/src/routes/Settings.tsx:193`) and `WorkspaceSettingsRoute` (`:110`) render
  `sectionsOfArea` from `lib/settings.ts:24-37` (workspace: `workspace, projects, models, channels,
  presentation, plugins`; daemon: `updates, daemon-models, dictation, host-tools, security,
  device`). Each route reads/writes its own section set from `?section=`; the daemon route's sections
  use `api.root`, the workspace route's use the route's `WorkspaceProvider`.
- **The model precedence is three tiers** (`packages/core/src/models/resolve.ts:21`):
  `effective = stored.weaver ?? daemonOverlay.weaver ?? DEFAULT`. The workspace's **stored** value
  (`config.models.weaver`, optional) is distinct from the **effective** value `GET /api/w/:ws/models`
  returns. `GET /api/w/:ws` (`packages/server/src/routes/workspace.ts:18-20`) returns the whole
  `config`, so `config.models` is the stored, optional shape.
- **`PUT /api/w/:ws/models` requires both settings** (`WorkspaceModelsPutSchema`,
  `packages/shared/src/config.ts:232-237`) and `models.set` always stores both
  (`packages/core/src/models/index.ts:58-75`); there is **no API that clears one field back to
  inherit**. `PATCH /api/w/:ws/config` deep-merges (`workspace.ts:67-76`) and can therefore set one
  field without touching the other, but deep-merge cannot delete a key, and a `null` field fails the
  schema.
- **Mutation hooks are context-scoped.** `useSetModels`, `usePatchConfig`, `useSetDaemonModels`,
  the project mutations, the Telegram channel mutations and `usePutPresentation` all read `useWs()`
  (`packages/ui/src/api/context.tsx:67`) rather than taking an override; the read hooks that need to
  address another workspace (`useWorkspaceSummary(ws)`, `useProjects(ws)`, `useRoutinesMany(ids)`,
  `useRoutineUsageFor(ws,id)`, `useRoutineFires(ws,id)`, `useModelsMany(ids)`) do take one.
  `WorkspaceProvider` (`context.tsx:17`) takes `remember` and `live` flags.
- **The design's read-only items map to real behaviour, not settings.** "Reviews every approval
  before you see it" is the weaver's review pass (`human-decisions/conductor-review`); "Let me
  override a held card" is the override flow (`human-decisions/approval-integrity`); the Knowledge
  curation schedule is `knowledge/scheduled-curation` (Sundays 03:00, over-budget curate early).
  None has a stored control, so the redesign shows them as descriptions.
- **The design's Scheduled screen has no buttons** (`Screens.dc.html:1122-1141`); the ticket
  explicitly keeps V1's create, edit, pause and delete (`GlobalScheduled.tsx`), which already exist
  as `useCreateRoutineAt`/`usePatchRoutineAt`/`useRemoveRoutineAt` taking `ws` explicitly.

## Goals / Non-Goals

**Goals**

- `/v2/settings` shows the two-level global screen: scope row, section row, applies-to line; daemon
  and workspace sections each read and write their real setting.
- Models is redesigned to one row per agent, with the daemon default and the workspace override in
  the same screen and the difference between them named.
- `/v2/scheduled` is the design's list with scope in the project's hue and V1's create/edit/pause/
  delete, fire history and 7d spend kept.
- Read-only descriptions are not presented as controls; no Budget tab; V1 is untouched.
- Tests cover scope switching, override and reset with the difference footer, the kept sections
  rendering, and the Scheduled CRUD.

**Non-Goals**

- Any daemon, HTTP API, config schema or migration change. Every read and write uses an existing
  endpoint.
- New settings fields. The kept sections expose the fields that already exist
  (`defaults.yolo`, `defaults.proposalApproval`, `defaults.deliveryMode`, `defaults.autoMerge`,
  `defaults.hireApproval`, `defaults.knowledgeBudgetTokens`, presentation, channels, projects).
- Spend caps, the Budget tab, or the design's key-value "Keys" table (no client for account keys).
- Promoting V2 to `/`, or changing V1's Settings/Scheduled screens.
- Carrying V1's read-only **Plugins** list, and the workspace Name/Ticket-prefix editor. Both are
  V1 settings the design and the ticket's kept-section list leave out; V1 at `/` still serves them.
  Flagged under Open Questions rather than silently dropped.

## Decisions

### 1. One global Settings route; a workspace scope is a tab, not a second route

Settings stays at `/v2/settings` (already routed). The scope lives in the URL as `?scope=<wsId>`
(absent = `This daemon`) and the section as `?section=<key>`, so a reload and a shared link keep
both. The scope row is `This daemon` followed by every real workspace from `useWorkspaces()`, in the
design's order. Changing scope resets the section to that scope's first (`updates` for daemon,
`weaver` for a workspace), matching the mockup (`Screens.dc.html:2055-2058`). The applies-to line
reads "This daemon — applies to every workspace on this machine." or "{Name} — applies to this
workspace only." The daemon has no applies-to control.

**Why not a `/v2/w/$ws/settings` route.** VS-343's `web-v2/navigation` spec makes scope travel with
navigation and exactly one rail row highlight; a separate workspace settings route would add a
second destination and a second rail fact for one screen group. The design is explicitly "Global,
with two tab levels" (HANDOFF §9), the daemon and workspace sections share one header, and the
contrast between the two is the point.

**Read/write plumbing.** The workspace-scoped body is wrapped in
`<WorkspaceProvider ws={selectedWs} remember={false} live={false}>` so every context-scoped
mutation hook (`useSetModels`, `usePatchConfig`, `usePatchProject`, the Telegram hooks,
`usePutPresentation`) addresses the selected workspace with no new hook. `remember={false}` keeps
selecting a scope in Settings from changing the app's remembered workspace; `live={false}` avoids
opening an event stream per scope (nothing in Settings needs live events). This mirrors
`V2Workspace` (`V2Root.tsx:20`), which already wraps `/v2/w/$ws` in a `WorkspaceProvider`. The
daemon body does not mount a provider.

### 2. The section row is a V2-owned table, not V1's `lib/settings.ts`

V1's table splits the two areas across two routes and names sections the design does not
(`daemon-models`, `device`, `plugins`). V2 keeps one screen and the design's names, so a new
`v2/settings/sections.ts` holds the two ordered lists and the first-section rule:

- **Daemon:** `updates`, `models`, `security`, `host-tools`, `dictation`, `device`.
- **Workspace:** `weaver`, `models`, `projects`, `knowledge`, `approvals`, `channels`,
  `presentation`.

The daemon list is the design's three first (Updates · Models · Security & devices) followed by the
kept V1 sections. The workspace list is the design's four first (Weaver · Models · Projects ·
Knowledge) followed by the kept ones. No entry is a dead tab — every one renders a body that reads
and writes a real setting. `lib/settings.ts` is reused only for `SETTINGS_AREAS`-style labels if it
helps; the V2 table is the source of truth for the V2 section row so V1's routes are untouched.

### 3. Models: one card per agent, one row per agent, options as collapsed rows

Both scopes render an agent card (`v2/settings/ModelCard.tsx`) with the agent's name and a note, then
a three-column grid — `runtime`, `model`, `thinking` — in one row per agent
(`Screens.dc.html:1199-1218`), instead of V1's stack of full-width selects. The daemon notes are the
design's verbatim: "One per workspace. Reads every approval before you do." and "The default a
ticket runs on when it names no option."

Model/thinking behaviour reuses V1's proven rules unchanged, extracted into `v2/settings/model.ts`:
a runtime's models come from `useRuntimeModels(runtime)`; a model outside the known list is "custom"
with a free-text id field; a non-empty `efforts` list is a picker, an empty one hides the control,
and an unknown one (or a custom model) is free text (`Settings.tsx:1113-1141`). This keeps the
V1 contract (VS-252) while changing the layout.

Worker options are collapsed rows (id, model tag, one-line summary, rotating chevron). Expanding one
reveals the multiline "When to use" field with the character count and the line "Write it as a rule,
not a mood. The weaver reads this and nothing else.", then the runtime/model/thinking row and a
Remove link. The permanently-visible empty "new option" form is replaced by `+ Add option`, which
appends a collapsed blank row to edit. This is a deliberate UX change (HANDOFF §9) with no API
change: the editor still validates against `WorkerModelOptionSchema`/`WorkerOptionsArraySchema`
exactly as V1 does (`Settings.tsx:1472-1495`).

The **daemon** Models section edits the daemon overlay via `useDaemonModels`/`useSetDaemonModels`.
An empty overlay field is a real state (`DaemonModels.weaver: ModelSetting | null`); the card shows
the built-in default (`claude`, no model) recessed and a Reset clears the overlay back to it. The
**workspace** Models section is Decision 4.

### 4. Workspace overrides are value-based, with Reset writing the daemon's value

The ticket asks for an `inherited`/`overridden` tag and Override / Reset to daemon. The API settles
which shape is possible:

- `GET /api/w/:ws/models` returns the **effective** value (stored ?? overlay ?? default), fully
  filled.
- `GET /api/daemon/models` returns the overlay as nullable fields — the baseline.
- `PUT /api/w/:ws/models` requires **both** `weaver` and `workers` and always stores both; there is
  no endpoint that clears one field back to inherit, and `PATCH /config`'s deep merge cannot delete
  a key.

So a per-field "inherit" flag cannot be stored or cleared frontend-only. The override model is
therefore **comparison-based**, computed by a pure helper in `v2/settings/override.ts`:

- `baselineFor(field)` = the daemon overlay's value for that agent/option if filled, else the
  built-in default (`DEFAULT_MODEL_SETTING`: `claude`, no model, no effort).
- `state = equal(workspaceEffective, baseline) ? 'inherited' : 'overridden'`, with the diff list
  naming each differing field (`runtime: OpenCode → Claude Code`, `thinking: high → max`).
- **Override** reveals the controls in the active style and lets the human pick a different value;
  the write is `PUT /models` with the workspace's effective settings and that one field changed.
- **Reset to daemon** writes `PUT /models` with the baseline value copied into that field (leaving
  the other field as it is). The tag then reads `inherited` again because the value equals the
  baseline.
- The footer names the actual diff ("Overrides thinking high → max.") or "Inherited from the
  daemon."; the banner counts distinct overridden agents and options from the same computed map, so
  the count, the tags and the footers cannot disagree (HANDOFF §15).

Worker options compare per id against the daemon overlay's option list; editing one writes the
workspace's full option list (the list is replaced wholesale by `PUT /models`), copying the daemon's
descriptions so a workspace changes a model, never an option's meaning.

**Trade-off, stated plainly:** because `PUT /models` stores both agents, saving an override for one
agent also pins the other agent's current value in `workspace.yaml`. The tag still reads `inherited`
for the untouched agent while its value equals the baseline, and starts reading `overridden` only if
the daemon overlay later moves away from it — which is then true. The alternative (a new endpoint
that clears one field) is a backend change, explicitly out of scope.

### 5. Read-only descriptions are plain rows, never controls

The Weaver section renders the three items as a description list: a label, an explanatory line and,
for the tier, a static `.v2-tag` ("standard") — no `role="switch"`, no `<select>`. The Knowledge
section's Curation rows are a key-value list (`schedule` → "weekly · Sunday 03:00",
`over budget` → "curate early"). The Knowledge budgets above them (`defaults.knowledgeBudgetTokens`
and `defaults.bootstrapBudgetTokens`) are real editors via `usePatchConfig`, so the section both
reads/writes what is real and describes what is not configurable.

### 6. Scheduled is V1's behaviour in the design's list

`/v2/scheduled` renders every workspace's routines with `useRoutinesMany(ids)` (ids from
`useWorkspaces`), so no `WorkspaceProvider` is needed, and the mutation hooks take `ws` explicitly.
Each row is the design's anatomy (`Screens.dc.html:1124-1139`): a status dot derived from the last
fire, the name, a mono line `scheduleLabel(r) · <workspace> · <project>`, and a right-aligned
next-run/last-result stack. The scope is the workspace name plus the project named by
`template.projectId`, and the project's name takes its identity hue from `lib/projectColor.ts` (or
`--text-2` for a routine with no project / "all projects"). Expanding a row keeps V1's fire history
(`useRoutineFires`), its 7d spend (`useRoutineUsageFor`) and the edit form; Pause/Resume and Remove
stay, and the Add form stays. The list-only mockup gains these controls because the ticket keeps
them; they are real (`useCreateRoutineAt`/`usePatchRoutineAt`/`useRemoveRoutineAt`), so nothing is a
dead control (HANDOFF §15).

### 7. Tests follow the V2 harness

Pure logic — section/scope resolution, the override/diff model, the scheduled-label and scope
formatter — is unit-tested with no DOM. The screens are tested with the `v2shell.test.tsx` pattern:
`vi.mock('@tanstack/react-router')`, `vi.mock('../app/link')`, `vi.mock('../api/hooks')` with fixed
data, then a dynamic import of the component so the mocks bind (`v2shell.test.tsx:6-41`). The
override test drives `useSetModels` and asserts the write body carries the baseline value for a
reset and the changed value for an override, plus the footer text; the scope-switching test drives
the URL and asserts the section list and body change; the kept-section tests render each section.
`v2theme.test.ts`'s `.v2-` selector rule and `v2router.test.ts`'s lazy-import rule constrain any new
CSS and any route change.

## Risks / Trade-offs

- [The value-based override definition can call an explicitly-pinned-but-equal value "inherited")
  → accepted and documented: the API cannot store "inherit" per field, and the visible behaviour
  (the value shown, the diff footer, Reset to daemon) is identical either way. Reset sets the
  daemon's value, which is what the ticket asks for.
- [Saving one agent's override pins the other agent's value in `workspace.yaml`]
  → inherent to `PUT /models` requiring both; flagged in the design and in the section's copy so
  the operator is not surprised. A future ticket can add a per-field endpoint.
- [Wrapping the workspace scope in a second `WorkspaceProvider` could double-mount a stream]
  → mitigated by `live={false}` and `remember={false}`; the test asserts no `EventStream` is opened
  by the Settings screen.
- [Section count and section key drift between the URL and the table]
  → one `v2/settings/sections.ts` table drives the row, the fallback and the body switch, tested
  for "every listed section renders a body".
- [A section whose data is unreachable (e.g. Voxtype absent, no projects) renders nothing]
  → each section keeps V1's loading/empty/error states (`SkeletonRows`, `EmptyState`,
  `ErrorState`), so a section is never blank without an explanation.

## Migration Plan

None. Frontend-only, additive: two new `v2/settings/**` and `v2/scheduled/**` module trees, the two
placeholder page exports swapped to render them, and tests. No persisted data moves; V1's routes,
components and tests are untouched. Rollback is reverting the branch.

## Open Questions

Resolved at plan review (2026-09-13):

1. **V1 parity gaps — carried.** Captain asked for both: a workspace **General** section holding
   V1's Name / Ticket-prefix editor (restyled), and a workspace **Plugins** section holding V1's
   read-only loaded-plugins list. Both are in `sections.ts`, the every-section-renders test, and
   each has a render test.
2. **This device and the theme switch.** V1's Device section no longer ships its dark/light/system
   buttons into V2: `DeviceSection` takes `themeControl` (default `'full'`, so V1 is unchanged) and
   V2 renders it as `'note'`, pointing at the V2 rail-footer switch.

Follow-up (separate ticket, blocked on this one): real per-agent inherit — `PUT` accepting `null`
per agent and `GET` reporting each field's source — so the value-based comparison in
`v2/settings/override.ts` can be swapped without touching the section components. The trade-off copy
in the UI is kept to one short banner line and will be removed by that ticket.
