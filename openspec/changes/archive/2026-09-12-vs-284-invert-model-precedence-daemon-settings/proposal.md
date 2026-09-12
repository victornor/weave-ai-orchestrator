## Why

captain: *"Model overrides should work in reverse of how they work now. The daemon settings
models should be the default with workspace models acting as overrides."*

Today `effectiveModels()` (`packages/core/src/models/resolve.ts:18`) takes the daemon overlay
whenever it is filled and ignores the workspace's own stored setting; `modelsLocked()` then tells
the web app to disable that workspace's control. captain wants the opposite shape: the daemon
sets a floor every workspace starts from, and a workspace that configures its own weaver or
workers setting rises above it.

The reason this is not a one-line operand swap: `WorkspaceModelsSchema`'s `weaver`/`workers`
fields are `ModelSettingSchema.default({})`, so a workspace that has never touched its model
settings still parses to a fully populated `{ runtime: 'claude', model: null }`. There is today no
representable difference between "this workspace has never configured a setting" and "this
workspace explicitly chose claude with no model pinned." Naively writing
`stored.weaver ?? overlay.weaver` would make every workspace in existence silently win over the
daemon with `claude`/`null`, making the daemon setting dead configuration that appears to work.
Fixing that representable-absence gap is the actual work of this change.

## What Changes

- **`WorkspaceModelsSchema`'s `weaver` and `workers` become genuinely optional** (no
  `.default({})`): absent means "this workspace has not configured this control," distinct from a
  present `ModelSetting` (even one with `model: null`, which still means "configured to let the
  runtime pick"). The outer `models` block keeps its own default of `{}` so a config with no
  `models` key at all still parses.
- **`effectiveModels()` is inverted**: for each of `weaver`/`workers`, the workspace's own stored
  setting wins when present; otherwise the daemon overlay if filled; otherwise the schema's
  built-in default (`claude`, no model). The worker-options catalog follows the same rule,
  whole-list, not merged: the workspace's catalog wins when non-empty, otherwise the daemon's
  catalog if non-empty, otherwise empty — unchanged from today's "whichever side is filled wins"
  test for the catalog, just with the two sides swapped.
- **`modelsLocked()` and `ModelsLocked` are deleted**, along with the `locked` field on `GET/PUT
  /models` and `ModelsService.locked()`. A workspace control can no longer be locked out by the
  daemon, so there is nothing left for that concept to report. `ModelsService.set()` drops the
  branch that silently discarded a write to a "locked" field.
- **The workspace Settings page's model controls are always enabled.** The "Set in the daemon
  settings → Models" locked-hint copy is removed; the two settings and the worker-options editor
  render exactly as an unlocked control does today.
- **The daemon Models page's copy is corrected**, not restructured: its existing per-row
  inherit/override toggle (`OverlaySetting` in `packages/ui/src/routes/Settings.tsx`) still fills
  or clears the daemon overlay exactly as it does today, but "Override for every workspace" and
  "disable the matching workspace Models fields" are false under the new precedence and are
  reworded to state what actually happens: this row sets the default every workspace starts from
  until it configures its own.
- **A one-time migration clears a masked stored value on an existing workspace.** The schema fix
  alone is not enough: `initWorkspace` bakes today's schema default into every workspace's
  `models` block at creation time, and a `PUT /models` before this change can leave real, concrete
  values there too — so an existing `workspace.yaml`, whether or not a human ever chose its
  values, typically already has a fully-populated `models` block on disk (confirmed against this
  host's own `workspace.yaml`, which holds explicit `weaver: opus` / `workers: sonnet` while the
  daemon holds a filled `workers: opencode/deepseek-flash` overlay — today's daemon-wins precedence
  means `deepseek-flash` is what actually runs). Without a migration, shipping the schema fix alone
  would flip that specific case the wrong way: the workspace's now-"present" `sonnet` would start
  winning the moment this ships. At load, once per workspace, a control whose daemon overlay is
  currently filled has its workspace-stored value cleared if one exists — preserving the value
  already in force, not the bytes already on disk — because a value that could not have taken
  effect while the daemon was locking that control (writes to a locked control were already
  discarded server-side) is not a deliberate choice worth keeping. A control whose daemon overlay
  is empty is left untouched, since it was already the effective value under the old precedence and
  remains so under the new one. Full reasoning and the acceptance test against this host's actual
  shape: design.md.
- **A brand-new workspace stays on the daemon's setting from creation**, since the schema fix means
  `initWorkspace` no longer bakes a default into `weaver`/`workers` — there is nothing to migrate
  for a workspace created after this change ships.
- **`WorkspaceModels` (the always-fully-filled shape) stays the type of an *effective*, resolved
  read** (`effectiveModels()`'s return, the `GET /models` wire shape, `ModelMigration.models`,
  `DEFAULT_WORKSPACE_MODELS`) — none of that changes shape or type. What changes is the type of
  the *stored* config field (`WorkspaceConfig['models']`), whose `weaver`/`workers` become
  `ModelSetting | undefined`.

## Not in scope

- Per-ticket worker model tiers: a ticket naming a catalog option keeps winning over both the
  workspace and daemon settings, unchanged.
- Any workspace-Settings UI beyond removing the lock: no new "this is overriding the daemon"
  indicator on the workspace page.
- Listing, on the daemon Models page, every workspace currently overriding a filled daemon
  default. The page keeps stating what default it provides; enumerating overriding workspaces
  would need a query across every workspace's config that nothing on that page does today, and
  the ticket marks this half optional. Skipped — see design.md.

## Capabilities

### Modified Capabilities

- `model-selection/workspace-model-settings`: the effective value of a workspace's weaver or
  workers setting is now the workspace's own stored setting when present, falling back to a
  filled daemon overlay, falling back to the schema default — inverted from today's
  overlay-first order.
- `model-selection/daemon-overrides`: a filled daemon overlay is now the *default* a workspace
  inherits until it configures its own value for that control, not a value that forces every
  workspace and disables its Settings control. Renamed within this capability from "overlay wins"
  to "overlay is the fallback"; the capability's requirements, scenarios, and the Models page copy
  they describe are rewritten accordingly. The per-row inherit/override choice on the daemon
  Models page is kept as the mechanism for filling/clearing the overlay, reworded to describe what
  it now does.
- `model-selection/worker-options`: the effective catalog is now the workspace's catalog when
  non-empty, falling back to the daemon's catalog — inverted from today's daemon-first order. The
  catalog's other rules (id uniqueness, the 16-option cap, unconfigured options) are unchanged.
- `model-selection/turn-resolution`: the one-sentence precedence rule a turn resolves through
  ("the effective setting or catalog SHALL be the daemon overlay when filled, otherwise the
  workspace's stored value") is inverted to match; everything else about how a turn resolves
  (single source, no role/project/agent fallback, unconfigured-option failure, unregistered-runtime
  failure) is unchanged.
- `model-selection/settings-migration`: gains a new one-time migration requirement, sibling to the
  existing VS-77 "a workspace arrives at the two settings by itself" migration in the same
  capability and the same file (`packages/core/src/models/migrate.ts`): an existing workspace's
  stored value for a control the daemon currently overlays is cleared once, so the value already in
  force before this change keeps governing after it, rather than the workspace's previously-inert
  stored value starting to win.

## Impact

- `packages/shared/src/config.ts`: `WorkspaceModelsSchema`, `ModelsLocked`/`ModelsLockedSchema`
  removed, `WorkspaceModels` type split conceptually into the stored shape (this schema) and the
  effective shape (unchanged, still fully filled).
- `packages/core/src/models/resolve.ts`: `effectiveModels()`, `modelsLocked()` (removed),
  `workerOptionRuntimes()`.
- `packages/core/src/models/migrate.ts`: new `demaskWorkspaceModels()` one-time migration, sibling
  to `deriveModelSettings`/`hasModelSettings`.
- `packages/core/src/workspace/loader.ts`: `loadWorkspace()` invokes the new migration, gated by
  its own meta-table flag, after the existing VS-77 migration block and before `effectiveModels()`
  is first computed for that load.
- `packages/core/src/models/index.ts`: `ModelsService.get()`/`set()`/`locked()` (removed).
- `packages/core/src/api.ts`: `ModelsService` interface.
- `packages/server/src/routes/models.ts`: drops `locked` from the response.
- `packages/ui/src/api/types.ts`, `packages/ui/src/routes/Settings.tsx`: drop the `locked`
  field and the disabled/locked-hint branches on the workspace Models section; reword the daemon
  Models page's overlay copy.
- `packages/cli/src/commands/models.ts`: `weave models show`'s `(daemon)` mark and `assertUnlocked`
  (which refuses `models set`/`options add|set|remove` with a `conflict` when the daemon holds the
  control) are removed — every one of those commands always writes the workspace's own setting now.
- `packages/cli/src/commands/daemon.ts`: `weave daemon models options`'s description ("named
  worker-model options that override every workspace catalog") is corrected to say it is the
  default for a workspace with no catalog of its own.
- Tests: `packages/shared/src/config.test.ts` (or wherever `WorkspaceModelsSchema` is tested),
  `packages/core/src/models/resolve.test.ts`, `packages/core/src/models/index.test.ts`,
  `packages/core/src/workspace/loader.test.ts` (a real on-disk unconfigured `workspace.yaml`
  fixture), `packages/ui/src/test/models.test.tsx` (the "disables a locked weaver control
  (VS-185)" test changes meaning: a filled daemon overlay must leave the workspace control
  enabled).
