## Why

A fresh AgentConductor deployment arrives with an empty worker-options catalog, and every option that does exist must name a runtime — omitting one silently becomes `claude`. Captain wants a new install to already offer the three when-to-use tiers (`quick`, `standard`, `deep`) at the daemon level, with no adapter or model chosen, and with that unfinished state impossible to miss and impossible to run by accident.

## What Changes

- **Fresh-install seed.** The first time a daemon has no `daemon.yaml`, it is written with a filled daemon catalog overlay of three options — `quick`, `standard`, `deep` — using the when-to-use descriptions already in use, verbatim. The id stays `quick` (captain said "fast"; that is the existing id). Per-workspace catalogs remain the opt-in: a filled daemon overlay locks them, as today.
- **Unconfigured is representable.** A worker option's `runtime` MAY be `null`, meaning not yet chosen. That is distinct from `model: null` (the runtime picks). Conductor and workers *settings* are unchanged: they still require a runtime and still default to `claude`.
- **No silent fallback.** An option with `runtime: null` SHALL NOT be parsed, stored, or launched as `claude`. Using it to run a worker fails with a named reason (`model_unconfigured`). Creating or assigning a ticket onto that id is rejected the same way an unknown id is. A missing or deleted id still falls back to the workers setting.
- **Unmissable warning.** While the daemon catalog overlay contains any option with no runtime, the web app shows a failed-tone banner on every signed-in page. It says that worker adapters are not chosen and points at daemon Settings → Models. There is no dismiss control; the banner goes only when no such option remains (each has a runtime, or has been removed).
- **Existing installs are not migrated.** A `daemon.yaml` that already exists is not rewritten, even if it has no `models` key. Schema default for `DaemonConfigSchema.parse({})` stays empty overlays.
- **In-place configure.** Daemon (and workspace) catalog rows can set runtime and model on an existing option, so the seeded tiers are configurable without delete-and-re-add.
- **BREAKING** for the option schema only: `WorkerModelOption.runtime` becomes `string | null`. An option YAML that omitted `runtime` used to become `claude`; it now stays unset and refuses to run. Any option that already names a runtime is unchanged.

## Capabilities

### New Capabilities

- `model-selection/unconfigured-option`: `runtime: null` on a worker option means not yet chosen; using that option is refused with a named error; nothing fills a runtime the operator did not pick.
- `model-selection/fresh-install-defaults`: first write of an absent `daemon.yaml` seeds the three daemon catalog tiers, unconfigured; a file that already exists is left alone.
- `web-settings/unconfigured-models-banner`: app-wide, non-dismissible warning until the daemon catalog has no unconfigured option.

### Modified Capabilities

- `model-selection/worker-options`: an option may have no runtime; the catalog and `ac_worker_models` surface that; create/assign reject an unconfigured id; catalog rows are editable.
- `model-selection/turn-resolution`: a ticket that names an unconfigured option fails the turn rather than launching or falling back to the workers setting.
- `model-selection/daemon-overrides`: a brand-new daemon arrives with the catalog overlay already filled (the seed); empty-until-the-operator no longer holds for that first write.

## Impact

**Schema.** `WorkerModelOptionSchema` overrides `runtime` to nullable. New `DEFAULT_WORKER_TIERS` constant (the three ids + verbatim descriptions + `runtime: null`, `model: null`). New error code `model_unconfigured`.

**Core.** First-boot seed in daemon start when `daemon.yaml` is absent. `modelSettingFor` / ticket `resolveWorkerModelId` refuse an unconfigured option. Engine/dispatcher/spawn fail with that code, never `runtime_unreachable` for a null runtime.

**API / CLI.** `GET`/`PUT /api/daemon/models` already carry the catalog; they must round-trip `runtime: null`. `ac_worker_models` returns unset runtimes so the conductor can see the tiers and know not to file onto them. `conductor models show` / `conductor daemon models show` print that an option is unconfigured.

**Web.** App-wide banner from `GET /api/daemon/models`. Daemon Models (and the shared catalog editor) edit runtime/model on a row. Unconfigured rows are labelled as not chosen, not as `claude`.

**Docs.** PLAN §5, `docs/API.md`, ADR amending 0012/0013. Telegram / TUI banners out of scope — refusal is server-side.

**Verification.** None of this is observable on the already-configured live daemon. Seed and non-migration are proven against a temp config directory with no `daemon.yaml`, and against one that already exists.
