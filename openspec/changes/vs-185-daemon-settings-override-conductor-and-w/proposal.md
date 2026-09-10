## Why

Repeating the same conductor model, workers default, and named worker-option catalog in every
workspace is overhead once a daemon hosts many of them. Captain asked on 2026-09-10 for optional
daemon-level overrides: when filled, every workspace uses those values and the matching workspace
Settings fields are disabled; when empty, per-workspace Settings work as today.

## What Changes

- **Optional daemon overlays** for the three model controls, independently: conductor setting,
  workers default setting, and the named worker-options catalog. Each overlay is a full
  `{ runtime, model, effort? }` (options also carry `id` + `description`), not a model string
  alone — model ids are not portable across runtimes.
- **Filled wins everywhere.** A present daemon overlay is the effective value for every
  workspace's turns, `GET /models`, `ac_worker_models`, and ticket `workerModelId` validation.
  Workspace Settings greys out / disables that control. Workspace yaml is not rewritten.
- **Empty restores today.** An absent/null overlay (and an empty daemon catalog) leaves that
  control on the workspace. Clearing an overlay makes per-workspace Settings apply again,
  including values stored while the overlay was in force.
- **Ticket create is unchanged.** `ac_worker_models` / `workerModelId` still pick from the
  effective catalog (daemon if filled, else workspace). Unknown id at write time is still
  rejected; a later overlay that drops an id falls back to the effective workers setting.
- **ADR 0013** records the daemon overlay as the exception to ADR 0011/0012's
  workspace-only sources. Roles, projects and agent rows still cannot choose a runtime or a
  model.

## Capabilities

### New Capabilities

- `model-selection/daemon-overrides`: optional per-control overlays on the daemon, empty vs
  filled, effective-value resolution for every workspace, workspace fields disabled when
  locked, live apply without restart, and restore-on-clear.

### Modified Capabilities

- `model-selection/workspace-model-settings`: the two workspace settings remain the defaults
  when no daemon overlay is set; a filled daemon overlay is the additional source that may
  govern them; workspace Settings and CLI cannot change a locked control.
- `model-selection/worker-options`: the catalog a ticket may name is the effective catalog
  (daemon overlay if filled, else workspace); `ac_worker_models` returns that catalog.
- `model-selection/turn-resolution`: a turn still resolves from one reader; that reader uses
  the effective settings after overlay.
- `web-settings/settings-scopes`: the daemon area also holds the model overlays. Workspace
  Models stay in the workspace area (disabled when locked). Existing scenario names kept.

## Impact

**Config.** `DaemonConfigSchema` gains optional `models: { conductor?, workers?, workerOptions? }`
in `packages/shared/src/config.ts`. Workspace schema unchanged.

**Core.** `effectiveModels(daemon, workspace)` feeds `modelSettingFor`, ticket catalog
validation, `ac_worker_models`, usage probe set, and loader runtime-homes. Overlay is read
live from the shared `DaemonConfig` (same in-place mutation as VS-179 transcription).

**API / CLI.** `GET`/`PUT /api/daemon/models`. `GET /models` returns effective values plus
`locked: { conductor, workers, workerOptions }`. `PUT /models` does not write a locked
control into workspace yaml. `conductor models` shows effective + locked; `conductor daemon
models` sets overlays.

**Clients.** Settings → This daemon → Models edits overlays. Workspace Models disables a
locked control with a hint. Telegram / TUI out of scope.

**Docs.** `docs/PLAN.md` §5, `docs/API.md`, ADR 0013. Product decision "exactly two settings
per workspace" is amended, not silently dropped.
