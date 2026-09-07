## Why

Which model an agent runs on is currently decided by a five-level fallback chain spread over three
tables and two config blocks. The engine resolves a turn's model as
`agent.model ?? role.model ?? config.defaults.model ?? <whatever the CLI defaults to>`
(`packages/core/src/runs/engine.ts:234`), and its runtime as `agent.runtime_id`, which was copied
from `role.runtime_id` at spawn (`packages/core/src/workers/index.ts:79`), which was copied from
`project.runtime_id` at hire (`packages/core/src/roles/index.ts:98`), which was copied from
`defaults.runtime` at project add (`packages/core/src/projects/index.ts:139`). Four places write a
runtime and five can write a model: `workspace.yaml`'s `defaults` and `conductor` blocks, each
project, each role (editable from the Team page), each agent row, and the hire approval card's
"Approve, but run on codex" option.

Nothing shows the operator the resolved answer, so the layers only become visible when they
disagree. On 2026-09-07 the conductor was running on Fable and every worker on Opus 5, because
`conductor.model` was set and `defaults.model` was null — nothing was misconfigured, the chain
simply had two different endpoints. The workspace owner asked for exactly two settings instead:
the conductor's runtime and model, and the workers' runtime and model, per workspace, with nothing
else influencing the choice.

## What Changes

- **Two settings, one place.** `workspace.yaml` grows a top-level `models` block holding exactly
  two settings, `conductor` and `workers`, each `{ runtime, model, effort? }`. Every worker in the
  workspace runs on `models.workers` whatever its role or project; the conductor runs on
  `models.conductor`.
- **`effort` survives, inside the two settings.** It is a real knob — all three of the claude,
  codex and opencode adapters translate it into a CLI flag (`packages/runtimes/*/src/args.ts`) —
  so dropping it would silently change how turns run. It becomes an optional field of each setting
  and is removed from everywhere else.
- **BREAKING: every other runtime, model and effort setting is removed.**
  - `defaults.runtime`, `defaults.model` and `conductor.runtime|model|effort` leave the config
    schema; `conductor` keeps only `channels`, `heartbeatIntervalSec` and `humanName`.
  - `projects[].runtime` and `projects[].model` leave the config schema, and `runtime_id`/`model`
    leave the `projects` table. `POST /projects` no longer accepts `runtime`, and onboarding no
    longer asks for one per project.
  - `runtime`, `model` and `effort` leave `RoleSpec` and the `roles` table. The Team page's
    per-role runtime and model selects are gone, `POST /roles/:id/activate` takes no body, and the
    hire approval card offers approve or decline only — no "Approve, but run on \<runtime\>".
  - `model` and `effort` leave the `agents` table. `agents.runtime_id` stays but stops being an
    input: it records the runtime the agent is currently on, written from the setting, and the
    engine never reads it to decide.
  - **BREAKING: the stuck-worker retry card no longer offers "Retry on \<other runtime\>".** That
    option wrote a per-agent runtime override (`packages/core/src/decisions/service.ts:185`), which
    the new model forbids. The card keeps retry now, retry later and cancel, and says that changing
    the runtime is a workspace setting.
- **Resolution has one source.** The engine reads `models.conductor` for a conductor turn and
  `models.workers` for a worker turn, and records the resolved runtime and the model the runtime
  actually reported on the run. Nothing on a role, a project or an agent can change the answer.
- **Changing a setting starts a new session.** A session ref is a handle belonging to one CLI, so
  when the setting's runtime differs from the runtime of the agent's active session, that session is
  closed and the next turn starts a fresh one. Today `ensureConductor` rewrites `agents.runtime_id`
  on a config change and leaves the session pointing at the old CLI
  (`packages/core/src/workers/index.ts:197`).
- **Existing workspaces are migrated on load, with the reasoning logged.** The conductor setting
  comes from the current `conductor` block; the workers setting comes from the runtime and model
  the workspace's roles actually use. Where the roles disagree, the daemon picks nothing silently:
  it uses the most common runtime, records the disagreement, and raises a decision asking the
  operator which runtime the workers setting should hold.
- **Two surfaces show and set them.** A `Models` section in the web app's workspace Settings area
  (two runtime pickers listing installed adapters, two model pickers offering that runtime's known
  models plus free text), and `conductor models [show|set]` in the CLI.

## Capabilities

### New Capabilities

- `model-selection/workspace-model-settings`: the two settings a workspace holds, what each carries,
  that no other setting may influence a model or runtime choice, and the two surfaces that show and
  change them.
- `model-selection/turn-resolution`: how a turn resolves its runtime, model and effort from the two
  settings; that role, project and agent state cannot influence it; what a run records; and that
  changing a setting's runtime starts a new session rather than resuming another CLI's.
- `model-selection/settings-migration`: how a workspace configured under the old layered scheme
  arrives at the two settings, what is logged, and the decision raised when its roles disagreed
  about the runtime.

### Modified Capabilities

- `web-settings/settings-scopes`: the list of sections filed under the workspace area gains the
  models section and loses the conductor section, whose only settings were the conductor's runtime
  and model.
- `run-recovery/stuck-worker-parking`: the parking decision no longer offers retrying on each of the
  other runtimes, because that option was a per-agent runtime override.
- `usage-plan-limits`: the set of runtimes whose accounts are probed becomes the runtimes named by
  the two settings, rather than every runtime any agent, project or role row mentions.

## Impact

**Config and schema.** `packages/shared/src/config.ts` (`WorkspaceConfigSchema`,
`WorkspaceDefaultsSchema`, `ProjectConfigSchema`, `RoleSpecSchema`); a new DB migration dropping
`projects.runtime_id`, `projects.model`, `roles.runtime_id`, `roles.model`, `roles.effort`,
`agents.model`, `agents.effort`; `packages/shared/src/types.ts` (`Project`, `Role`, `Agent`).

**Core.** `runs/engine.ts` (resolution and finalize), `workers/index.ts` (spawn and
`ensureConductor`), `sessions/index.ts` (runtime change closes a session), `roles/index.ts` (hire,
activate, charter rendering), `projects/index.ts` (add, patch, `openspec init --tools`),
`decisions/service.ts` (the `runtime:` answer keys), `usage/accounts.ts` (which runtimes are
probed), `workspace/loader.ts` (the migration and the runtime config homes), `prompts/index.ts`, a
new `models` service on `CoreServices` and `packages/core/src/api.ts`.

**API.** `PATCH /conductor` loses `runtime|model|effort`; `POST /roles/:id/activate` loses its body;
`PATCH /roles/:id` no longer accepts them in the patch; `POST /projects` loses `runtime`; new
`GET /models` and `PUT /models`. `docs/API.md` changes with them.

**Clients.** `packages/ui`: a new Models settings section, the Conductor section removed, the Team
role sheet's runtime and model selects removed, onboarding's per-project runtime step removed;
`packages/cli`: `conductor models`, `conductor conductor set-model|set-runtime` removed,
`conductor role`/`project` runtime columns removed.

**Docs.** `docs/PLAN.md` §5, §6 and §8 describe the layered scheme this change removes, so the
deviation needs `docs/adr/0011-*`; `docs/OPERATIONS.md` and the onboarding copy change with the
surfaces.
