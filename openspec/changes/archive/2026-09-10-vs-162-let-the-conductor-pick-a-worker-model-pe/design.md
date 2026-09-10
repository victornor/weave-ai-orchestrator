# Design — per-ticket worker model from a workspace catalog

## Context

See proposal.md for why. Today `modelSettingFor(config, kind)` is the only reader
(`packages/core/src/models/resolve.ts`). Every worker turn, spawn stamp, session lookup and
login-pause target goes through it. `GET`/`PUT /models` is the whole `WorkspaceModels` block
(`{ conductor, workers }`); the CLI get-then-puts that block, and Settings spreads `current`
when saving one side. ADR 0011 forbade per-ticket overrides; this change is the catalog-shaped
exception captain asked for on 2026-09-09, recorded as ADR 0012.

## Goals / Non-Goals

**Goals:**

- One catalog in `workspace.yaml`, edited from the same Models surfaces as the two settings.
- One optional id on the ticket, resolved at every worker launch through `modelSettingFor`.
- Existing workspaces and existing `PUT { conductor, workers }` clients keep working.

**Non-Goals:**

- Changing `models.conductor` the same way.
- Auto-switching a ticket's chosen id after its worker has spawned.
- Per-role catalogs, or a free runtime/model on the ticket.
- Snapshotting runtime/model onto the ticket (the catalog stays live, like VS-77 settings).
- Injecting the catalog into the conductor bootstrap digest.

## Decisions

### D1 — Catalog beside the two settings, not instead of `models.workers`

```yaml
models:
  conductor: { runtime: claude, model: claude-fable-5-1 }
  workers:   { runtime: claude, model: claude-opus-5, effort: high }
  workerOptions:
    - id: cheap
      description: Frontend, low complexity, scouts and retrieval.
      runtime: opencode
      model: glm-4.6
    - id: strong
      description: High-complexity or backend-heavy changes.
      runtime: claude
      model: claude-opus-5
      effort: high
```

`models.workers` remains the documented default when a ticket omits an id. An empty
`workerOptions` is the migration: every current workspace already behaves correctly.

Rejected: replacing `workers` with `{ default: <id>, options: [...] }`. That would break
`GET`/`PUT /models` and every test that asserts `models.workers.runtime`.

### D2 — An option includes runtime, not only a model id

Captain asked for "runtime/model id plus a short when-to-use description". A scout on a cheap
OpenCode model and a change on Claude is the point of VS-159. Each option is `ModelSetting` plus
`id` and `description`. Session retirement when the resolved runtime changes is already specified.

Rejected: model-only options pinned to `models.workers.runtime`. Cheaper to implement, does not
meet the request.

### D3 — The ticket stores the option id; resolution is live

`tickets.worker_model_id TEXT NULL`, set at create or at assign-before-spawn, like
`landing_branch`. `modelSettingFor(config, kind, ticket?)` looks the id up in
`config.models.workerOptions`. Missing ticket, null id, or a deleted id → `models.workers`.

Live lookup matches VS-77 ("a change applies to the next turn"). Editing an option's model
updates the next turn of every ticket that names it. Deleting an option does not rewrite
tickets; they fall back. Auto-switching the *id* after spawn stays out of scope: writes that
try are rejected.

Unknown id at create/assign is a `validation` error so a typo cannot silently become the
default.

Rejected: snapshotting `{ runtime, model, effort }` onto the ticket. That would ignore later
catalog edits and invent a second source `modelSettingFor` is supposed to not have.

### D4 — `modelSettingFor` stays the only reader

```ts
export function modelSettingFor(
  config: Pick<WorkspaceConfig, 'models'>,
  kind: AgentKind,
  ticket?: { workerModelId?: string | null } | null,
): ModelSetting;
```

Call sites that have the ticket pass it: `workers.spawn`, `engine`, `dispatcher`, per-agent
authgate, `sessions.forTurn` for workers. Call sites without a ticket (conductor,
`openspec init --tools`, the governing-runtime set) keep using the two settings. The
governing/probe set unions option runtimes so a catalog runtime is not treated as abandoned.

### D5 — PUT omits `workerOptions` → keep the existing list

`WorkspaceModelsSchema` defaults `workerOptions` to `[]` for config load. The `PUT /models`
body treats an omitted `workerOptions` as "leave the catalog as it is" and an explicit array
(including `[]`) as replace. Otherwise onboarding's `PUT { conductor, workers }` and any
client that still sends the two-setting shape would wipe the catalog.

CLI `models set conductor|workers` already get-then-puts the whole block, so once GET
returns `workerOptions` it is preserved. Settings must spread `current` the same way it
does today — which works once GET includes the array.

### D6 — Conductor tool, not bootstrap

`ac_worker_models` is conductor-only, no input, returns `{ default, options }`. VS-159
already measured a fat first-turn prefix; a tool the conductor calls when filing is cheaper
than injecting the catalog into every turn. Workers do not get the tool; they may still pass
`workerModelId` on `ac_ticket_create` if they know an id, or omit it.

`ac_ticket_create` and `ac_ticket_assign` gain optional `workerModelId`. Assign applies it
only while `ticket.workerId` is null, then spawns.

### D7 — Surfaces

Settings → Models keeps the two pickers and adds a catalog list under them (id, description,
runtime, model, effort; add / edit / remove). CLI:

```
conductor models show
conductor models set conductor|workers ...
conductor models options add --id <id> --description <text> --runtime <id> [--model <id|default>] [--effort <e>]
conductor models options set <id> ...
conductor models options remove <id>
conductor ticket create ... --worker-model <id>
```

No new Board ticket-create picker unless one already exists; humans edit the catalog, the
conductor (or CLI) picks per ticket.

### D8 — ADR 0012, not a silent PLAN edit

PLAN §5 and ADR 0011 say the two settings are the whole of model selection. The deviation is
ADR 0012: a ticket may name a catalog id; roles, projects and agent rows still cannot. ADR
0011 stays accepted for everything else.

## Risks / Trade-offs

- **A deleted option silently falls back.** → Create/assign reject unknown ids, so the only
  way this happens is an operator removing an option later. Documented; tickets keep the
  stored id so the fallback is visible on the ticket.
- **Partial PUT wiping the catalog.** → D5. Tested: PUT without `workerOptions` preserves it;
  PUT with `workerOptions: []` clears it.
- **Option runtime not in the probe/login-pause set.** → D4 unions option runtimes into
  `runtimesInUse` and the governing set.
- **Mid-ticket id change.** → Rejected after spawn. Editing the *option* still applies next
  turn, which is VS-77 behaviour, not auto-switch.

## Migration Plan

No YAML rewrite. `workerOptions` defaults to `[]`. New nullable column. Rollback: an older
release ignores the column and the extra YAML key (Zod strips unknown keys on the old
schema); the catalog is dormant until the new release runs again.

## Open Questions

None. Catalog-vs-replace, runtime-per-option, live id vs snapshot, and tool-vs-bootstrap are
decided above.
