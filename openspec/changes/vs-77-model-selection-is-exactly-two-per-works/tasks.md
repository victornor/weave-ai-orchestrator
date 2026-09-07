# Tasks

## 1. Config schema and shared types

- [x] 1.1 Add `ModelSettingSchema` (`runtime` string defaulting to `claude`, `model` nullable
      defaulting to null, `effort` optional) and a `models` block (`conductor`, `workers`) to
      `WorkspaceConfigSchema` in `packages/shared/src/config.ts`, exporting `ModelSetting` and
      `WorkspaceModels`. Verify with a shared test that a config with no `models` block parses to
      both settings on `claude` with no model.
- [x] 1.2 Remove `runtime` and `model` from `WorkspaceDefaultsSchema`, `runtime`, `model` and
      `effort` from the `conductor` block (keeping `channels`, `heartbeatIntervalSec`,
      `humanName`), `runtime` and `model` from `ProjectConfigSchema`, and `runtime`, `model` and
      `effort` from `RoleSpecSchema`. Verify with a shared test that a `RoleSpec` carrying
      `runtime` is rejected by `.strict()` parsing and that an old `workspace.yaml` shape still
      parses (the removed keys are ignored, not an error).
- [x] 1.3 Drop `runtimeId`, `model` and `effort` from `Role`, `runtimeId` and `model` from
      `Project`, and `model` and `effort` from `Agent` in `packages/shared/src/types.ts`, keeping
      `Agent.runtimeId` and `Run.runtimeId`/`Run.model`.

## 2. Database

- [x] 2.1 Add `packages/db/src/migrations/0012_model_settings.sql` dropping
      `projects.runtime_id`, `projects.model`, `roles.runtime_id`, `roles.model`, `roles.effort`,
      `agents.model` and `agents.effort`, leaving `agents.runtime_id`, `runs.runtime_id`,
      `runs.model`, `agent_sessions.runtime_id` and `usage_events.*` untouched.
- [x] 2.2 Verify with a db test that a database seeded on the previous schema migrates, that the
      dropped columns are gone and the kept ones still hold their values, and that migrating twice
      is a no-op.

## 3. Resolution

- [x] 3.1 Add `packages/core/src/models/resolve.ts` with `modelSettingFor(config, kind)` returning
      the setting for a conductor or a worker turn. Unit-test both kinds and the defaulted config.
- [x] 3.2 Make `packages/core/src/runs/engine.ts` build `TurnInput.model`, `effort`, the adapter
      lookup and the config home from `modelSettingFor`, and finalize take the model from the
      runtime's report falling back to the resolved setting (`engine.ts:212, 234-236, 311`).
- [x] 3.3 Make `packages/core/src/workers/index.ts` stamp `agents.runtime_id` from the resolved
      setting at spawn and in `ensureConductor` — no `role.runtimeId`, `role.model`, `role.effort`
      — and `packages/core/src/runs/dispatcher.ts` write the run's `runtimeId`/`model` from it.
- [x] 3.4 Verify with core engine tests that a worker turn launches on the workers setting and a
      conductor turn on the conductor setting; that changing the setting changes the next launch;
      and that a role row and an agent row written directly with a different runtime and model
      change nothing about what the fake adapter is given.
- [x] 3.5 Verify with a core engine test that a setting naming an unregistered runtime fails the
      turn with `runtime_unreachable` naming that runtime.

## 4. Sessions

- [x] 4.1 Make `sessions.forTurn` retire the active session and start a new one when its
      `runtime_id` is not the resolved runtime, reporting `stale: true`; make `sessions.reset` use
      the resolved setting instead of `config.defaults.runtime`
      (`packages/core/src/sessions/index.ts:41-58, 85-87`).
- [x] 4.2 Verify with core session tests that changing the runtime retires the session and hands no
      old handle to the new runtime, that the turn is told its session restarted, and that changing
      only the model or the effort keeps the session.

## 5. Removing the other settings from core

- [x] 5.1 `roles/index.ts`: hire writes no runtime, model or effort; `activate(actor, id)` takes no
      options; the hire decision offers approve and decline only (drop the `runtime:` options at
      `roles/index.ts:120` and the runtime line from the card's context); the charter rendering and
      `prompts/index.ts` stop naming a runtime or a model.
- [x] 5.2 `projects/index.ts`: `add` and `patch` write no runtime or model; `openspec init --tools`
      takes the workers setting's runtime (`projects/index.ts:62`); the project row no longer
      carries them (`:120, :139, :281`).
- [x] 5.3 `decisions/service.ts`: remove the `runtime:` answer handling for both the hire card
      (`:135-136`) and the retry card (`:184-185, :213`), so an unknown answer key is rejected
      again.
- [x] 5.4 `runs/engine.ts`: the parking decision offers retry now, retry later or at the reset time,
      and cancel — no per-runtime options — and its context names the workers setting as where the
      runtime is changed (`engine.ts:488-513`).
- [x] 5.5 `usage/accounts.ts`: `runtimesInUse()` becomes the two settings' runtimes unioned with the
      distinct runtime of non-retired agents (`accounts.ts:42-49`).
- [x] 5.6 `workspace/loader.ts:208`: seed the runtime config homes from the registered runtimes and
      the two settings.
- [x] 5.7 Verify with core tests that answering a retry card with a `runtime:` key is rejected, that
      a parked worker's card carries no runtime option, that hiring and activating a role write no
      runtime, and that the probe set is the two settings plus live agents.

## 6. The models service and the API

- [x] 6.1 Add a `models` service to `CoreServices` (`get()`, `set(actor, patch)`, `reconcile()`) in
      `packages/core/src/models/`, declared on `packages/core/src/api.ts`, saving through
      `ctx.saveConfig` and emitting `workspace.updated`. Add it to
      `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` so unrelated tests
      do not throw on the proxy.
- [x] 6.2 Add `GET /models` and `PUT /models` (whole block, parsed through the schema) to the
      server; remove `runtime|model|effort` from `PATCH /conductor`
      (`packages/server/src/routes/workers.ts:97`), the body from `POST /roles/:id/activate`, and
      `runtime` from `POST /projects`. Update `packages/server/src/routetable.ts`.
- [x] 6.3 Verify with server tests that `PUT /models` round-trips both settings, that a role patch
      carrying `runtime`, `model` or `effort` is a `validation` 400, that `POST /projects` with
      `runtime` is rejected, and that no role, project or agent response carries the removed fields.
- [x] 6.4 Update `docs/API.md` for the new and changed routes.

## 7. Migration

- [x] 7.1 Add `deriveModelSettings(rawConfig, roleRows)` in `packages/core/src/models/migrate.ts`:
      conductor from the raw `conductor` block falling back to raw `defaults`; workers from the
      most common role runtime and its model, falling back to raw `defaults`, then to the conductor
      runtime with a null model; returning the settings, the runtime counts and which rule fired.
      Unit-test single-runtime, mixed-runtime, no-roles and already-migrated inputs.
- [x] 7.2 Call it from `loadWorkspace` between opening the database and building the context
      (`workspace/loader.ts:197`), reading the raw YAML before `WorkspaceConfigSchema` strips the
      old keys; write the derived block back, and log one `info` line with the settings, the
      runtime counts and the rule. Verify with a core loader test on a temp workspace that an old
      `workspace.yaml` comes back with a `models` block and without the removed keys, and that a
      second load rewrites nothing.
- [x] 7.3 Where the roles disagreed, record `modelsMigration` in `workspaces.settings_json` and
      have `models.reconcile()` raise one `question` decision owned by the human, correlated on
      `models:workers-runtime`, with one option per runtime the roles used and the written one
      recommended; answering it writes the setting and clears the flag. Call `reconcile()` from the
      per-workspace startup block in `packages/server/src/daemon.ts:182`.
- [x] 7.4 Verify with core tests that a mixed-runtime workspace gets exactly one open decision, that
      a second `reconcile()` raises no second card, and that answering it writes the workers
      setting and clears the flag.

## 8. Web app

- [x] 8.1 Replace the `conductor` entry with `models` in `SETTINGS_SECTIONS`
      (`packages/ui/src/lib/settings.ts`) and add a `ModelsSection` to
      `packages/ui/src/routes/Settings.tsx` with both settings, each a runtime `<select>` over
      `GET /runtimes`, a model `<select>` over `GET /runtimes/:id/models` and a free-text entry for
      a model that is not listed; move the transcription note to the workspace section and delete
      `ConductorSection`.
- [x] 8.2 Add `useModels`/`useSetModels` to `packages/ui/src/api/hooks.ts` and `qk`, remove
      `usePatchConductor`, and drop `runtimeId`, `model` and `effort` from the `Role`, `Project`
      and `Agent` types in `packages/ui/src/api/types.ts` (keeping the agent's recorded runtime and
      the run's model, which the Worker and Run pages display).
- [x] 8.3 Remove the runtime and model selects from the Team role sheet
      (`packages/ui/src/routes/Team.tsx:165-210`) and the per-project runtime select and its draft
      field from `packages/ui/src/routes/Onboarding.tsx`, keeping the one runtime/model step and
      widening its copy to cover both settings.
- [x] 8.4 Verify with ui tests that the models section renders both settings and writes each,
      accepts a model that is not in the list, that Settings offers no conductor section, that the
      role sheet offers no runtime or model, and that onboarding asks for no per-project runtime.
      Add the new hooks to every route test that mocks `../api/hooks` wholesale.

## 9. CLI

- [x] 9.1 Add `conductor models` (show) and `conductor models set conductor|workers --runtime
      --model --effort`, with `--model default` clearing it; remove `conductor conductor
      set-runtime|set-model` (`packages/cli/src/commands/conductor.ts:32-39`) and the RUNTIME
      columns and rows from `role.ts` and `project.ts`.
- [x] 9.2 Verify with CLI tests that `models` prints both settings and that `models set` sends the
      whole block with one setting changed.

## 10. Docs and the ADR

- [x] 10.1 Add `docs/adr/0011-two-model-settings-per-workspace.md` recording the deviation from
      PLAN §5, §6 and §8 (the layered defaults, the per-project and per-role runtime and model
      columns, the per-agent override), why, and the one-way column drop.
- [x] 10.2 Update `docs/PLAN.md` §5's `workspace.yaml` example and §6's `projects`, `roles` and
      `agents` column lists to the new shape, pointing at the ADR; update `docs/OPERATIONS.md`
      where it describes choosing a runtime per project or per role.
- [x] 10.3 Update the onboarding copy and any skill or template text that tells an agent a role or a
      project carries a runtime or a model.

## 11. Green

- [x] 11.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm --filter @agent-conductor/ui exec
      vitest run` all pass.
