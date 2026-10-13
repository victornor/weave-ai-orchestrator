## Context

See proposal.md for why. Today `modelSettingFor(config, kind, ticket?)`
(`packages/core/src/models/resolve.ts`) is the only reader of model selection. Settings live in
`workspace.yaml` (`WorkspaceModelsSchema`). Daemon config (`DaemonConfigSchema` in
`packages/shared/src/config.ts`) has no models key; the VS-179 pattern for a daemon-wide setting
is `GET`/`PUT /api/daemon/transcription` writing `daemon.yaml` and mutating `deps.daemon` in
place so the next read sees it without restart. Workspace contexts already receive that same
`DaemonConfig` object (`loader.ts` `daemon: opts.daemon`). Settings areas are the table in
`packages/ui/src/lib/settings.ts`; workspace Models is `key: 'models'`.

## Goals / Non-Goals

**Goals:**

- One overlay object on `daemon.yaml`, three independent optional controls.
- One `effectiveModels(daemon, workspace)` feeding the existing reader, ticket validation, and
  `ac_worker_models`.
- Workspace yaml is never copied-over by an overlay; clear restores stored values.
- Web Settings (daemon + workspace lock) and CLI; take effect next turn.

**Non-Goals:**

- Telegram / TUI (ticket).
- Forcing an empty catalog on every workspace (empty daemon catalog = no overlay).
- Model-string-only overlays that leave runtime on the workspace.
- Snapshotting overlay values onto tickets or rewriting workspace yaml while locked.

## Decisions

### D1 — Independent optional overlays, full settings

```yaml
# daemon.yaml
models:
  conductor: { runtime: claude, model: claude-fable-5-1 }
  workers:   { runtime: claude, model: claude-opus-5, effort: high }
  workerOptions:
    - id: cheap
      description: Scouts and low complexity.
      runtime: opencode
      model: glm-4.6
```

Each key omitted or null = no overlay for that control. `workerOptions: []` is also no overlay
(ticket: empty = workspace Settings work as today). A filled catalog is a non-empty array.

Rejected: all-three-or-nothing (ticket says "matching" fields). Rejected: model-id-only overlay
(ids are not portable; VS-77 settings are `{ runtime, model, effort? }`; VS-162 options already
include runtime).

### D2 — `effectiveModels` then `modelSettingFor` stays the only turn reader

```ts
effectiveModels(daemon, workspace): WorkspaceModels
// conductor/workers: overlay ?? stored
// workerOptions: overlay if non-empty array, else stored
```

`modelSettingFor` keeps its signature and reads the effective block. Call sites that already
pass `ctx.config` pass `effectiveModels(ctx.daemon, ctx.config)` (or a helper on the models
service). Ticket `resolveWorkerModelId` and `ac_worker_models` use the same effective catalog.

Rejected: a second reader, or baking overlay into `ctx.config.models` at load (that would make
`PUT /models` write daemon values into workspace yaml).

### D3 — Daemon routes mirror transcription; mutate in place

- `GET /api/daemon/models` → `{ conductor: ModelSetting | null, workers: ModelSetting | null, workerOptions: WorkerModelOption[] | null }`
- `PUT /api/daemon/models` `{ conductor?: ModelSetting | null, workers?: ModelSetting | null, workerOptions?: WorkerModelOption[] | null }`
  - omitted key = leave that overlay
  - `null` (or `workerOptions: []`) = clear
  - value = set (catalog must be non-empty to count as filled)
- Writes `daemon.yaml` via `writeDaemonConfig` and assigns onto `deps.daemon.models` in place
  (same object every workspace `ctx.daemon` points at). Session auth, not run tokens.
- Document in `docs/API.md`. Add to `routetable.ts`.

No restart. Next `effectiveModels` read sees it.

### D4 — Workspace GET is effective + locked; PUT never copies overlay into yaml

`GET /models` returns the effective `{ conductor, workers, workerOptions }` plus
`locked: { conductor: boolean, workers: boolean, workerOptions: boolean }`.

`PUT /models` still takes the two settings whole. For each locked control it **ignores** that
key and keeps the workspace-stored value, so a client that spreads `current` (the effective
block) cannot pollute yaml. Unlocked keys write as today (`workerOptions` omit-preserves).

CLI `conductor models set` / `options add|set|remove` GET first; if the target control is
locked, error telling the operator to use daemon models. `conductor models show` prints
effective values and marks locked controls.

`conductor daemon models show|set conductor|workers|options …` is the writer for overlays
(get-then-put the daemon block).

### D5 — Settings: daemon section `daemon-models`, workspace fields disable

`SETTINGS_SECTIONS` gains `{ key: 'daemon-models', label: 'Models', area: 'daemon' }` — cannot
reuse `models`, that key is the workspace section. Deep link `?section=daemon-models`.

Daemon Models reuses the existing runtime/model pickers plus catalog add/edit/remove, with a
clear-overlay control per field (empty = no overlay). Workspace Models disables a locked
control (greyed out, not editable) and hints to This daemon → Models.

Update every Settings mock that enumerates sections (`settingsScopes.test.tsx` and friends).

### D6 — Probe / runtime-home set includes overlay runtimes

`workerOptionRuntimes` and the loader's runtime-home set, plus `usage/accounts.ts`
`runtimesInUse`, union runtimes named by filled daemon overlays so a daemon-only runtime is
not treated as abandoned.

### D7 — ADR 0024, not a silent PLAN edit

PLAN §5 and ADR 0011/0023 say the two workspace settings (plus the workspace catalog) are the
whole of model selection. ADR 0024 records the daemon overlay: optional, per-control, live,
does not rewrite workspace yaml. Roles, projects and agent rows still cannot choose a runtime
or a model.

## Risks / Trade-offs

- **[Risk] PUT /models spreading effective values into workspace yaml.** → D4 ignores locked
  keys. Test: overlay set, PUT of the GET body, overlay cleared, workspace stored value is the
  pre-overlay one.
- **[Risk] `ctx.daemon` not the same object as `deps.daemon`.** → Loader already passes the
  shared object; PUT assigns onto that object. Tests assert a turn after PUT uses the overlay
  without rebuilding AppDeps.
- **[Risk] Old binary rejects `models:` in daemon.yaml on rollback.** → Same as VS-179
  `transcription.backend`. Document: clear overlays (or delete the `models` key) before
  running an older release. New fields are optional-with-empty so a new binary with no key
  behaves as today.
- **[Trade-off] Empty daemon catalog cannot force "no options anywhere".** Ticket: empty =
  workspace applies. Forcing a blank catalog everywhere is not requested.
- **[Risk] Existing tickets name a workspace-only option after a daemon catalog fills.** →
  Same as VS-162 deleted-option: next turn falls back to the effective workers setting;
  create/assign of an id not in the effective catalog is still `validation`.

## Migration Plan

No YAML rewrite, no DB migration. `DaemonConfigSchema.models` defaults to all-empty. Existing
workspaces unchanged until an overlay is filled. Rollback: clear overlays before an older
release, or the old schema will reject the unknown `models` key.

## Open Questions

None. Independent vs all-or-nothing, full setting vs model-id, empty catalog vs force-empty,
and GET effective-vs-stored are decided above.
