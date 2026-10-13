## 1. Schema

- [x] 1.1 In `packages/shared/src/config.ts`, override `WorkerModelOptionSchema.runtime` to `z.string().min(1).nullable().default(null)`. Export `DEFAULT_WORKER_TIERS` as `quick`, `standard`, `deep` with the verbatim descriptions from the ticket, each `runtime: null` and `model: null`. Export `isWorkerOptionConfigured`. Add `'model_unconfigured'` to `ERROR_CODES` and map it to HTTP 400. Verify `WorkerModelOptionSchema.parse({ id: 'quick', description: 'x' })` has `runtime: null`; parse with `runtime: 'codex'` stays configured; `ModelSettingSchema.parse({})` is still `{ runtime: 'claude', model: null }`; `DaemonConfigSchema.parse({})` still has empty overlays.

## 2. Fresh-install seed

- [x] 2.1 Add `ensureFreshDaemonConfig(dir)` on the workspace loader: existing `daemon.yaml` → `readDaemonConfig` unchanged; missing file → write `DaemonConfigSchema.parse({ models: { workerOptions: DEFAULT_WORKER_TIERS } })` and return it. Point `startDaemon` at it. Verify against a **temp config dir with no `daemon.yaml`**: the file is created, catalog is exactly the three tiers with those descriptions and null runtime/model, conductor and workers overlays empty. Verify against a temp dir whose `daemon.yaml` is `version: 1\n` (no models): overlay stays empty. Verify against a temp dir whose yaml already lists a custom option: that option is unchanged. Do not use the live daemon.

## 3. Refusal

- [x] 3.1 `resolveWorkerModelId` rejects an effective-catalog id whose runtime is null with `model_unconfigured` (message names the id). `modelSettingFor` throws the same when the named option exists and is unconfigured; it still falls back to workers for a missing/deleted id. Verify ticket create/assign tests: unconfigured id is rejected and not stored; configured id still stores; unknown id still `validation`.
- [x] 3.2 Engine/dispatcher/spawn: a worker turn whose ticket names an unconfigured option fails with `model_unconfigured` and starts no runtime process. Verify an engine test that would have launched on `claude` if the schema default still applied — assert the error code and that the fake runtime was not called. A configured option still launches. A missing id still uses the workers setting.

## 4. API, tools, CLI

- [x] 4.1 `GET`/`PUT /api/daemon/models` round-trip options with `runtime: null`. `ac_worker_models` returns those options with null runtime and its description tells the conductor not to file onto them. Verify a daemon-models route test: PUT the three unconfigured tiers, GET returns them; PUT one with `runtime: 'claude'` persists. Verify the MCP/tool test lists an unconfigured option as unset, not as `claude`.
- [x] 4.2 `conductor models show` and `conductor daemon models show` print that an option has no runtime chosen (not `claude`). Verify a CLI test against a fixture overlay with `runtime: null`.

## 5. Web

- [x] 5.1 `WorkerOptionsEditor` (shared by workspace and daemon Models): each existing row exposes runtime and model pickers; unconfigured shows an explicit not-chosen runtime, not `claude`; model is disabled until a runtime is set; changing runtime/model PUTs the catalog with id and description unchanged. Verify `models.test.tsx`: a row with `runtime: null` does not display `claude`; choosing a runtime saves that option configured; model control is disabled while runtime is unset.
- [x] 5.2 Add `ModelsUnconfiguredBanner` in `AppShell` beside `ConnectionBanner`. Show it when daemon `workerOptions` has any `runtime == null`; failed-tone, `role="status"`, copy that adapters are not chosen and to finish in daemon Settings → Models; control navigates to `/settings?section=daemon-models`; no dismiss. Verify a UI test: unconfigured overlay → banner on a workspace route and on `/settings`; every option configured or overlay null → no banner; no dismiss control present.

## 6. Docs and green

- [x] 6.1 Add `docs/adr/0019-unconfigured-worker-tiers.md` (nullable option runtime; first-boot seed of a missing `daemon.yaml` only; no migration). Point ADR 0023 and 0013 at it. Update `docs/PLAN.md` §5 and `docs/API.md` (`runtime: null`, `model_unconfigured`).
- [x] 6.2 `pnpm lint`, `pnpm typecheck`, and `pnpm test` (core suite **and** UI suite). Paste **both** suite blocks verbatim in the PR and the ticket comment — do not add the totals, do not report one suite as both.
