## Why

Every worker in a workspace runs on one setting (`models.workers`, VS-77 / ADR 0011). That
wastes spend: a scout, a low-complexity frontend ticket and a backend-heavy change all pay
for the same model. Captain asked on 2026-09-09 for several worker models, each with a short
when-to-use description, so the conductor can pick the fitting one when it files a ticket.

## What Changes

- **A workspace catalog of named worker options.** `models.conductor` and `models.workers`
  stay as they are — the conductor setting, and the default every worker uses when a ticket
  names no option. Alongside them, `models.workerOptions` is a list of `{ id, description,
  runtime, model, effort? }`. Empty list is valid and is how existing workspaces arrive.
- **A ticket may name one option.** `Ticket.workerModelId` is an optional kebab-case id,
  set at create or at assign while the ticket has no worker, never after spawn (auto-switch
  mid-ticket is out of scope). Unknown id at write time is rejected. Omitted id, or an id
  whose option was later deleted, falls back to `models.workers`.
- **Resolution still has one reader.** `modelSettingFor` takes the ticket when the agent is
  a worker. A matching option wins; otherwise `models.workers`. Roles, projects and agent
  rows still cannot choose a runtime or a model. A raw runtime/model on a ticket (not an
  option id) is rejected.
- **The conductor can list without guessing.** A conductor-only tool `ac_worker_models`
  returns the default workers setting and every option's `id`, `description`, `runtime`,
  `model` and `effort`. `ac_ticket_create` and `ac_ticket_assign` accept `workerModelId`.
- **The same catalog is edited from Settings and the CLI.** Settings → Models gains add /
  edit / remove for options. `conductor models options …` is the CLI. `GET`/`PUT /models`
  carries `workerOptions`; an omitted array on PUT keeps the existing list so a partial
  body cannot wipe the catalog.
- **ADR 0023** records the exception to ADR 0011's "no per-ticket override": the override
  is an id into a workspace-defined catalog, not a free runtime/model on the ticket, and
  not a per-role list.

## Capabilities

### New Capabilities

- `model-selection/worker-options`: the catalog (id + description + runtime/model/effort),
  the ticket field, the conductor list tool, create/assign accepting the id, the fallback
  when omitted or deleted, and rejection of an unknown id at write time.

### Modified Capabilities

- `model-selection/workspace-model-settings`: the two settings remain the defaults; the
  Models section and `conductor models` also show and edit the catalog; a ticket option id
  from that catalog is the only additional input that may influence a worker's runtime or
  model. Roles, projects, hire cards and agent rows still cannot.
- `model-selection/turn-resolution`: a worker turn resolves from the ticket's option when
  that option still exists, otherwise from `models.workers`. Conductor turns are unchanged.
  Changing an option's runtime still starts a new session on the next turn of a worker
  whose ticket names it.
- `usage-plan-limits`: the account-probe set includes runtimes named by worker options, not
  only the two settings plus live agents.

## Impact

**Config.** `WorkspaceModelsSchema` gains `workerOptions` (default `[]`) in
`packages/shared/src/config.ts`.

**Database.** One nullable `tickets.worker_model_id` column (next migration after 0020).

**Core.** `modelSettingFor` grows an optional ticket argument; spawn, engine, dispatcher,
sessions and authgate pass the ticket for workers. `usage/accounts.ts` and the loader's
runtime-home set include option runtimes. `tickets.create` / `assign` validate the id.

**API / MCP / CLI.** `GET`/`PUT /models` carry `workerOptions`; `POST /tickets` and
`POST /tickets/:id/assign` accept `workerModelId`; new `ac_worker_models`;
`ac_ticket_create` / `ac_ticket_assign` gain the field; `conductor models options` and
`conductor ticket create --worker-model`.

**Clients.** Settings → Models lists the catalog. Ticket types grow `workerModelId`.

**Docs.** `docs/PLAN.md` §5, `docs/API.md`, ADR 0023, conductor skill/template sentence
telling it to list and pick. Onboarding still writes the two settings only.

**Not touched.** The conductor's own model. Per-role lists. Changing `workerModelId` after
a worker has spawned.
