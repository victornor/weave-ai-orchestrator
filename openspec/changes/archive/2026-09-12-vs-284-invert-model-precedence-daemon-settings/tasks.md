## 1. Make "unconfigured" a representable state on the workspace schema

- [x] 1.1 In `packages/shared/src/config.ts`, drop `.default({})` from `WorkspaceModelsSchema`'s
      `weaver` and `workers` fields (`ModelSettingSchema.optional()` instead), leaving
      `workerOptions: WorkerOptionsArraySchema.default([])` as-is. The outer `models` field on
      `WorkspaceConfigSchema` keeps its own `.default({})`, so a config with no `models` key still
      parses. Export `DEFAULT_MODEL_SETTING = ModelSettingSchema.parse({})` for reuse. Verify with a
      unit test: `WorkspaceModelsSchema.parse({})` returns `{ workerOptions: [] }` with `weaver` and
      `workers` both `undefined`; `WorkspaceModelsSchema.parse({ weaver: { runtime: 'codex' } })`
      returns that `weaver` as given and `workers` still `undefined`.
- [x] 1.2 Add an `EffectiveModels` type (`{ weaver: ModelSetting; workers: ModelSetting;
      workerOptions: WorkerModelOption[] }`, fully required — the shape a resolved read always has)
      next to `WorkspaceModels` in the same file. Retype `DEFAULT_WORKSPACE_MODELS` as
      `EffectiveModels`, built directly as `{ weaver: DEFAULT_MODEL_SETTING, workers:
      DEFAULT_MODEL_SETTING, workerOptions: [] }` rather than via `WorkspaceModelsSchema.parse({})`
      (which would now leave `weaver`/`workers` undefined). Do not touch `WorkspaceModelsPutSchema`
      or `WorkspaceModelsPut` — the PUT body still requires both settings whole, unchanged.
- [x] 1.3 Delete `ModelsLockedSchema` and the exported `ModelsLocked` type. Grep for both names
      across `packages/` after deleting to confirm nothing outside the files this change touches
      (task groups 2-6) still references them; `pnpm typecheck` after this task's package builds
      will also surface any straggler as a compile error.

## 2. Invert the merge and drop locking in `packages/core/src/models`

- [x] 2.1 In `resolve.ts`, rewrite `effectiveModels()` so each of `weaver`/`workers` resolves as
      `stored.<field> ?? overlay.<field> ?? DEFAULT_MODEL_SETTING`, and `workerOptions` resolves as
      the workspace's own catalog when non-empty, otherwise the daemon's when non-empty, otherwise
      `[]`. Rename `catalogOverlayFilled` to `catalogFilled` (same `Array.isArray(x) && x.length >
      0` body) since it is now applied to both sides, not just the overlay. Retype the function's
      return as `EffectiveModels`. Delete `modelsLocked()` entirely.
- [x] 2.2 Retype `modelsFor()`'s return and `modelSettingFor()`'s `config.models ?? ...` fallback
      to use the new `EffectiveModels`/`DEFAULT_WORKSPACE_MODELS`. Retype `ModelMigration['models']`
      in `migrate.ts` to `EffectiveModels` (no logic change there — `deriveModelSettings` already
      produces a fully-filled object).
      Verify with unit tests in `packages/core/src/models/models.test.ts` (extend the existing
      `describe('effectiveModels (VS-185)', ...)` block, renaming/adding cases): a workspace-only
      setting is used untouched when the daemon overlay is empty (existing case, keep); a workspace
      setting wins when *both* the workspace and a filled daemon overlay have a value for the same
      control (new — this is the behavior this whole change exists to add); a filled daemon overlay
      governs when the workspace has not configured that control (new); neither configured falls
      back to `claude`/no model (new); the worker-options catalog case is workspace-first,
      whole-list (rewrite the existing "hides the workspace catalog only when the daemon catalog is
      non-empty" case to its inverse: the workspace's non-empty catalog wins over a filled daemon
      catalog).

## 3. One-time migration: an existing workspace's masked setting is cleared, not left to flip

This is the task group added after conductor review: `initWorkspace` and pre-change `PUT /models`
writes already bake a fully-populated `models` block into every existing `workspace.yaml`, so task
group 1's schema fix alone would make an existing workspace's stored (but previously inert) value
start winning the moment this ships — see design.md's "Compatibility" section for the concrete
regression this would cause on this codebase's own daemon (`workers` would move from
`opencode`/`deepseek-flash` to `claude`/`sonnet`).

- [x] 3.1 In `packages/core/src/models/migrate.ts`, add `demaskWorkspaceModels(config:
      WorkspaceConfig, daemon: { models?: DaemonModels } | null | undefined): { weaver?: boolean;
      workers?: boolean; workerOptions?: boolean }` (or equivalent): for each of `weaver`, `workers`
      and `workerOptions`, if the workspace's stored `config.models` has a value for that control
      **and** the daemon's overlay for that same control is filled, mutate `config.models` to clear
      it (delete the key / set to `undefined`, or `[]` for `workerOptions`) and record that it was
      cleared. A control that is not both stored and daemon-filled is untouched. Pure function,
      unit-tested directly: given a `config.models` with `weaver`/`workers` both set and a daemon
      with only `workers` filled, only `workers` is cleared.
- [x] 3.2 In `packages/core/src/workspace/loader.ts`'s `loadWorkspace()`, call
      `demaskWorkspaceModels` once per workspace, gated by its own meta-table flag (new key, e.g.
      `vs284_masked_settings_cleared`, following the exact pattern `ROLE_RUNTIMES_META_KEY`/
      `hasModelSettings` already use for the VS-77 migration a few lines above it). Run it after
      that VS-77 migration block (so it always sees the two-settings shape) and before the
      `effectiveModels(opts.daemon, config)` call already in this function. When it clears
      anything, write the updated config back via `writeWorkspaceYaml`/`unresolveEnvRefs` (same
      call the VS-77 block already makes) and log, at `info`, which controls were cleared and what
      now governs each (the daemon overlay's value) — an operator should be able to find out why a
      workspace's effective setting changed without diffing the yaml by hand. Insert the meta flag
      row once the migration has run, whether or not it cleared anything, so it is never
      re-evaluated.
- [x] 3.3 Verify against this host's actual shape, not a hand-built object: a test that builds a
      `WorkspaceConfig` with `models: { weaver: { runtime: 'claude', model: 'opus' }, workers: {
      runtime: 'claude', model: 'sonnet' } }` and a daemon config with `models: { weaver: { runtime:
      'claude', model: 'opus', effort: 'high' }, workers: { runtime: 'opencode', model:
      'deepseek-flash', effort: 'high' } }` — the values from the conductor's review comment —
      and asserts: before the migration, `effectiveModels()` under the *old* (pre-this-change)
      precedence resolves `workers` to `opencode`/`deepseek-flash`; after `demaskWorkspaceModels`
      runs and `effectiveModels()` runs under the *new* precedence, `workers` still resolves to
      `opencode`/`deepseek-flash` — the same value, unchanged by the migration boundary. Also
      assert `weaver` (`opus` on both sides in this example) ends up cleared on the workspace too,
      since it was also masked, and its effective value is still `opus` either way.
- [x] 3.4 Verify the migration runs exactly once: loading the same workspace a second time (meta
      flag already set) with a stored value that was left in place because its control was
      unmasked at first load, then later observing that same control's daemon overlay become
      filled, does not clear it on the second load.

## 4. `ModelsService` and the HTTP surface

- [x] 4.1 In `packages/core/src/models/index.ts`, delete the `locked()` method and its
      `modelsLocked` import/re-export. Simplify `set()`: remove the `locked`-branch that silently
      kept the stored value for a locked field; `weaver`/`workers`/`workerOptions` are now always
      taken from `next` (workerOptions omitted still means "keep the existing catalog," unchanged).
      Retype `get()`/`set()`/`settleWorkersRuntime()` to return `EffectiveModels`. At the
      `settleWorkersRuntime` call site (spreads `ctx.config.models`), leave a short comment noting
      this only runs for a workspace that has already been through `deriveModelSettings` and so
      always has a fully-derived (non-optional) `models` block — the precondition the now-looser
      `WorkspaceModels` type would otherwise hide.
- [x] 4.2 In `packages/core/src/api.ts`, drop `locked(): S.ModelsLocked` from the `ModelsService`
      interface and retype `get()`/`set()`/`settleWorkersRuntime()` to `S.EffectiveModels`.
- [x] 4.3 In `packages/server/src/routes/models.ts`, drop `locked: models.locked()` from both the
      `GET /` and `PUT /` handlers' JSON responses.
      Verify: update `packages/core/src/models/models.test.ts`'s `describe('the models service',
      ...)` — rewrite `'get() returns a daemon overlay and set() does not write a locked control
      (VS-185)'` into a test asserting the opposite: `set()` writes the workspace's own value even
      while a daemon overlay is filled for that same control, and `get()` then returns the
      workspace's value, not the overlay's.

## 5. CLI: no more locked controls

- [x] 5.1 In `packages/cli/src/commands/models.ts`, delete the `locked` field from the local
      `WorkspaceModels` interface, delete `assertUnlocked` and its four call sites (`set`, `options
      add`, `options set`, `options remove`), and delete the `(daemon)` mark in `show`'s `mark()`
      helper — every command always reads and writes the workspace's own setting now.
- [x] 5.2 In `packages/cli/src/commands/daemon.ts`, reword the `overlayOptions` command's
      description from "named worker-model options that override every workspace catalog" to
      "named worker-model options that are the default for a workspace with no catalog of its
      own."
      Verify: run the existing CLI test suite covering `models`/`daemon models` commands (`find
      packages/cli -iname '*models*.test.ts'`) and fix any assertion still expecting a `conflict`
      on a "locked" write or the `(daemon)` mark.

## 6. Web app: workspace controls always editable, daemon page copy corrected

- [x] 6.1 In `packages/ui/src/api/types.ts`, delete the `ModelsLocked` interface and the `locked?:
      ModelsLocked` field on `WorkspaceModels`.
- [x] 6.2 In `packages/ui/src/routes/Settings.tsx`'s `ModelsSection`, delete the `locked`
      derivation and `lockedHint`; the two `ModelSettingFields` and the `WorkerOptionsEditor` drop
      their `disabled={locked.*}` props (never disabled from this section) and their hints revert
      to the plain, always-shown text ("The agent you talk to..." / "Every worker in this
      workspace...").
- [x] 6.3 In `DaemonModelsSection`/`OverlaySetting` (same file), reword the section's lead
      paragraph and `OverlaySetting`'s `hint`/scope-`<option>` copy per design.md's "What the
      daemon Models page states" decision — filled means "the default every workspace uses until
      it configures its own," not "overrides every workspace"; empty means "no daemon default;
      each workspace's own setting is used, or claude with no model chosen if it has not set one
      either." Do not change `OverlaySetting`'s fill/clear/preview mechanics, only its strings.
      Verify with `packages/ui/src/test/models.test.tsx`: rewrite the case named "disables a locked
      weaver control (VS-185)" into one asserting the opposite — with a filled daemon overlay, the
      workspace's weaver control is enabled, and changing and saving it persists; add or adjust a
      case for the daemon Models page's reworded copy if the existing tests assert the old strings
      verbatim.

## 7. Prove compatibility against the shape a real install has today, and rollback

- [x] 7.1 Add a test (in `packages/core/src/workspace/loader.test.ts` or wherever `loadWorkspace`
      is already covered) loading a `workspace.yaml` fixture shaped like task 3.3's real-host
      example (both settings fully stored, daemon overlay filled for `workers` only) and asserting
      the post-load effective `workers` setting is the daemon's, unchanged across the upgrade — the
      end-to-end version of task 3.3's unit test, through the actual `loadWorkspace()` path. Add a
      second fixture with no `models` key at all (a workspace created before this change but never
      opened Settings → Models, if such a workspace exists) and confirm it still loads and resolves
      sensibly (workspace unconfigured on every control, daemon or schema default governs, nothing
      to demask).
- [x] 7.2 Add a round-trip test: build a `WorkspaceConfig` whose `models.weaver` is `undefined`
      (post-migration, or freshly created), run it through `toLegacySpelling` then
      `YAML.stringify`, and assert the serialized text contains no `conductor:`/`weaver:` key under
      `models` (not a `null` value — the key is absent). Then `YAML.parse` that text and re-run it
      through `WorkspaceConfigSchema.safeParse` to confirm a pre-VS-284-shaped file still parses
      cleanly (this is also what a rollback reads).

## 8. Verify the whole change

- [x] 8.1 Run `pnpm lint && pnpm typecheck` and confirm both are clean.
- [x] 8.2 Run `pnpm test` (root — chains the core/server vitest run then the ui suite) and paste
      both suite blocks verbatim with their real totals in the ticket report, per this project's
      "report both suites" rule.
- [x] 8.3 Run `openspec validate vs-284-invert-model-precedence-daemon-settings --json --strict`
      and confirm it is clean.
