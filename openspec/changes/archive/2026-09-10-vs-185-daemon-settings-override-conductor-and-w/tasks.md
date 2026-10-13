## 1. Schema

- [x] 1.1 Add optional `models` to `DaemonConfigSchema` in `packages/shared/src/config.ts`:
      `{ conductor: ModelSettingSchema.optional(), workers: ModelSettingSchema.optional(),
      workerOptions: WorkerOptionsArraySchema.optional() }`, all defaulting to empty. Verify
      `DaemonConfigSchema.parse({})` has no filled overlays; a config with only `conductor` set
      leaves workers and workerOptions empty; `workerOptions: []` parses; duplicate option ids
      fail.

## 2. Resolution

- [x] 2.1 Add `effectiveModels(daemon, workspace)` in `packages/core/src/models/resolve.ts`
      (conductor/workers: overlay ?? stored; catalog: non-empty overlay else stored). Point
      `modelSettingFor` callers that currently pass `ctx.config` at the effective block (or a
      helper that reads `ctx.daemon` live). Verify unit tests: all empty → workspace; conductor
      overlay only; catalog overlay hides workspace catalog; `[]` catalog overlay does not hide.
- [x] 2.2 Use the effective catalog in `tickets.create` / `assign` `resolveWorkerModelId`.
      Verify: daemon catalog filled → workspace-only id is `validation`; daemon catalog empty →
      workspace id accepted as today.
- [x] 2.3 Union filled-overlay runtimes into `workerOptionRuntimes`, loader runtime-homes, and
      `usage/accounts.ts` `runtimesInUse`. Verify a runtime named only by a daemon option is
      probed.

## 3. Daemon API

- [x] 3.1 `GET /api/daemon/models` returns `{ conductor, workers, workerOptions }` with nulls
      when empty. `PUT /api/daemon/models` omit-leaves, `null` or `workerOptions: []` clears,
      a value sets; writes `daemon.yaml` and assigns onto `deps.daemon.models` in place.
      Session auth. Document in `docs/API.md` and `routetable.ts`. Verify GET default empty;
      PUT conductor persists and is visible on GET without rebuilding AppDeps; PUT null
      clears; omitted workers key leaves workers overlay; duplicate option id is 400.
- [x] 3.2 `GET /models` returns effective values plus
      `locked: { conductor, workers, workerOptions }`. `PUT /models` ignores locked keys and
      does not write them into workspace yaml. Verify: overlay set, GET shows overlay +
      locked true; PUT of that GET body; overlay cleared; stored workspace value is the
      pre-overlay one. Unlocked PUT still works as today.

## 4. Tools, CLI, engine

- [x] 4.1 `ac_worker_models` returns the effective workers default and effective catalog.
      Verify: daemon catalog filled → those options; empty overlay → workspace catalog.
- [x] 4.2 Engine/dispatcher test: daemon workers overlay filled, ticket names no option →
      launch uses overlay, not workspace `models.workers`. Conductor overlay filled →
      conductor turn uses overlay.
- [x] 4.3 `conductor models show` prints effective values and marks locked controls.
      `conductor models set` / `options add|set|remove` error when that control is locked.
      Add `conductor daemon models show|set conductor|workers` and `options add|set|remove`
      that GET-then-PUT `/api/daemon/models`. Verify CLI tests for show-locked, set-locked
      errors, and daemon set sending the overlay.

## 5. Web app

- [x] 5.1 Add `{ key: 'daemon-models', label: 'Models', area: 'daemon' }` to
      `SETTINGS_SECTIONS`. New daemon Models section: same pickers and catalog as workspace,
      plus clear-overlay per control; hooks against `GET`/`PUT /api/daemon/models`. Verify
      `?section=daemon-models` opens the daemon area; empty default; filling conductor PUTs
      and GET shows it; clear returns null.
- [x] 5.2 Workspace Models disables a locked control (not editable) with a hint to This
      daemon → Models. Saving an unlocked control still spreads `current` without writing
      locked fields. Verify ui tests: locked conductor picker disabled; adding a workspace
      option while conductor is locked still PUTs; Settings section mocks
      (`settingsScopes.test.tsx` and every file that enumerates sections) include
      `daemon-models`.

## 6. Docs and green

- [x] 6.1 Add `docs/adr/0024-daemon-model-overrides.md` (optional per-control overlay; live;
      does not rewrite workspace yaml; empty catalog = no overlay). Point ADR 0011/0023 at
      it. Update `docs/PLAN.md` §5 daemon.yaml/`models` note and `docs/API.md`.
- [x] 6.2 `pnpm typecheck`, `pnpm lint`, `pnpm test` and
      `pnpm --filter @agent-conductor/ui exec vitest run` all pass.
