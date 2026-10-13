# Tasks

## 1. Config schema and shared types

- [x] 1.1 Add `WorkerModelOptionSchema` (`id` kebab-case slug, `description` 1–200 chars, plus
      `ModelSettingSchema` fields) and `workerOptions` (array, max 16, default `[]`, unique
      `id`s) to `WorkspaceModelsSchema` in `packages/shared/src/config.ts`. Verify with a shared
      test that a config with no `workerOptions` parses to `[]`, that a duplicate id fails, and
      that the two settings still default as they do today.
- [x] 1.2 Add `workerModelId: string | null` to `Ticket` in `packages/shared/src/types.ts` and to
      `TicketCreateInput` in `packages/core/src/api.ts`. Verify the field is present on the type
      (typecheck) and that existing ticket fixtures that omit it still typecheck.

## 2. Database

- [x] 2.1 Add `packages/db/src/migrations/0021_ticket_worker_model.sql` adding nullable
      `tickets.worker_model_id TEXT` with no default. Verify with a db test that a database
      seeded on the previous schema migrates, that existing tickets read `workerModelId: null`,
      and that migrating twice is a no-op.

## 3. Resolution

- [x] 3.1 Extend `modelSettingFor(config, kind, ticket?)` in
      `packages/core/src/models/resolve.ts` so a worker ticket whose `workerModelId` matches an
      option returns that option's `{ runtime, model, effort }`, and any other worker input
      returns `models.workers`. Verify with unit tests: match, omitted, unknown/deleted id,
      conductor ignores the ticket argument.
- [x] 3.2 Pass the worker's ticket into `modelSettingFor` from `workers.spawn`,
      `runs/engine.ts`, `runs/dispatcher.ts`, and the per-agent authgate/session paths that
      already call it for workers. Leave conductor and `openspec init --tools` on the two
      settings. Verify with a core engine test that a worker whose ticket names an option
      launches on that option's runtime and model, not `models.workers`.
- [x] 3.3 Union worker-option runtimes into `usage/accounts.ts` `runtimesInUse()` and the
      loader's runtime-home set, and into authgate's governing-runtime set. Verify with a core
      test that a runtime named only by an option is probed, and that a runtime named by
      neither setting, nor any option, nor any live agent is not.

## 4. Ticket create and assign

- [x] 4.1 `tickets.create` accepts `workerModelId`, stores it when it matches the catalog, stores
      null when omitted, and throws `validation` when the id is unknown. Verify with core
      ticket tests for all three cases.
- [x] 4.2 `tickets.assign` accepts optional `workerModelId` and writes it only while
      `ticket.workerId` is null, then spawns; a write after spawn is `validation`. Verify with
      core tests that assign-before-spawn stores the id and the spawned worker is stamped with
      that option's runtime, and that assign-after-spawn rejecting leaves the stored id
      unchanged.
- [x] 4.3 Wire `workerModelId` through `ac_ticket_create`, `ac_ticket_assign`, `POST /tickets`
      and `POST /tickets/:id/assign`. Verify with a server or tools test that the conductor can
      create a ticket with a known id and that an unknown id is a `validation` error.

## 5. Models service and API

- [x] 5.1 `GET /models` returns `workerOptions`. `PUT /models` replaces the catalog when
      `workerOptions` is present (including `[]`) and keeps the existing catalog when the key is
      omitted. Validate unique ids, max 16, description length. Verify with server tests:
      round-trip, omit-preserves, explicit-empty-clears, duplicate id is 400.
- [x] 5.2 Add conductor-only `ac_worker_models` (no input) returning
      `{ default: ModelSetting, options: WorkerModelOption[] }`. Add it to `CONDUCTOR_TOOLS`.
      Verify it is listed for the conductor, absent for a worker, and that an empty catalog
      returns `{ default, options: [] }`.
- [x] 5.3 Update `docs/API.md` for `GET`/`PUT /models`, `POST /tickets`, assign, and the new
      tool.

## 6. Web app

- [x] 6.1 Extend `WorkspaceModels` in `packages/ui/src/api/types.ts` with `workerOptions`.
      Settings → Models shows the catalog under the two settings, with add / edit / remove of
      id, description, runtime, model and effort, reusing the existing runtime/model pickers.
      Saving a setting still spreads `current` so the catalog is not wiped. Verify with ui
      tests that options render, that adding one PUTs the full block including the new option,
      that removing one PUTs the remaining list, and that changing the conductor setting
      preserves existing options.
- [x] 6.2 Add `workerModelId` to the ui `Ticket` type. No new Board create-picker unless a
      ticket-create form already exists; if one does, add an optional option `<select>` there.

## 7. CLI

- [x] 7.1 `conductor models show` prints worker options (id, description, runtime, model).
      Add `conductor models options add|set|remove` that GET-then-PUT the whole block.
      Verify with CLI tests that show includes an option and that add sends the catalog plus
      the two settings.
- [x] 7.2 `conductor ticket create --worker-model <id>` passes `workerModelId` on the create
      body. Verify with a CLI test that the flag is present on the written input.

## 8. Docs, ADR, conductor prompt

- [x] 8.1 Add `docs/adr/0023-worker-model-options.md` recording the catalog exception to ADR
      0011 (ticket may name a catalog id; roles/projects/agents still cannot; live lookup;
      omitted PUT preserves the catalog). Point ADR 0011 at it. Update `docs/PLAN.md` §5's
      `workspace.yaml` example with `workerOptions` and the ticket column list.
- [x] 8.2 Add one sentence to the conductor template/skill that it MUST call `ac_worker_models`
      and pass `workerModelId` when filing a ticket if any options exist, otherwise omit it.

## 9. Green

- [ ] 9.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` and
      `pnpm --filter @agent-conductor/ui exec vitest run` all pass.
