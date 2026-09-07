# Design — two model settings per workspace

## Context

Runtime and model are written in four places and read in one, with a fallback chain between them:

| Layer | Written by | Read by |
|---|---|---|
| `defaults.runtime`, `defaults.model` | `workspace.yaml` | project add (`projects/index.ts:139`), engine's last model fallback (`engine.ts:234`), `sessions.reset` |
| `conductor.runtime|model|effort` | `workspace.yaml`, `PATCH /conductor` | `ensureConductor` (`workers/index.ts:191`) |
| `projects.runtime_id`, `projects.model` | project add/patch | hire (`roles/index.ts:98`), `openspec init --tools` (`projects/index.ts:62`) |
| `roles.runtime_id|model|effort` | hire, `PATCH /roles/:id`, hire-card answer, `roles.activate` | worker spawn (`workers/index.ts:79`), engine (`engine.ts:234-235`), finalize (`engine.ts:311`) |
| `agents.runtime_id|model|effort` | worker spawn, `ensureConductor`, retry-card `runtime:` answer (`decisions/service.ts:185`) | engine adapter lookup and model (`engine.ts:212, 234`), sessions, dispatcher |

The target collapses all of it to one config block read at turn time. The work is therefore mostly
deletion; the decisions worth recording are where deletion is not obviously safe.

## Goals

- Exactly one place a human changes a runtime or a model, per workspace, for each of the two kinds
  of agent.
- No code path that can make a turn run on something other than what that place says.
- An existing workspace comes out of the upgrade running on what it ran on before, or asks.

## Non-goals

- Per-role, per-project or per-ticket overrides. Explicitly rejected by the owner.
- New runtime adapters, or changing how an adapter maps a model id to its CLI flags.
- Changing the credential model. Config homes stay per workspace per runtime; VS-75 keys on the
  runtime id, which the two settings supply just as the old chain did.

## Decisions

### D1 — The block is `models`, with two settings, each `{ runtime, model, effort? }`

```yaml
models:
  conductor:
    runtime: claude
    model: claude-fable-5-1     # null = whatever the runtime picks
  workers:
    runtime: claude
    model: claude-opus-5
    effort: high                # optional
```

`runtime` is required and defaults to `claude`, matching today's `defaults.runtime`. `model` is
nullable with a `null` default, keeping "let the CLI decide" expressible — several runtimes have no
useful model list and free text is the escape hatch for a model the adapter has not heard of.

`effort` stays because it is not decorative: `packages/runtimes/claude/src/args.ts:94`,
`codex/src/args.ts:98` and `opencode/src/args.ts:37` each translate it into a CLI flag
(`--effort`, `model_reasoning_effort=`, `--variant`). Dropping it would change how every turn runs
in a workspace that sets it, silently. It is optional in both settings and is the only remaining
place it can be set.

Rejected: `defaults.models` (nests a workspace-level concept under a block named for inheritance,
which is exactly what this change removes) and two top-level blocks `conductorModel`/`workerModel`
(no single thing to show in one Settings section or one CLI command).

### D2 — Resolution reads the config, not the row

A new pure function is the single reader:

```ts
// packages/core/src/models/resolve.ts
export function modelSettingFor(config: WorkspaceConfig, kind: AgentKind): ModelSetting;
```

`engine.ts` calls it for the adapter lookup, `model`, `effort` and the config home; `workers.spawn`
and `ensureConductor` call it to stamp `agents.runtime_id`; `dispatcher.ts` calls it for the run
row. `agents.runtime_id` survives as a *record* — the Worker page shows it, the usage view groups
by it, and a run that is mid-flight when the setting changes must still be attributed to the
runtime it actually ran on — but no read of it decides anything. `agents.model` and `agents.effort`
have no such reader, so they are dropped.

The test that makes this real is negative as well as positive: write a role row and an agent row
with a different runtime and model directly into the DB, run a turn, and assert the fake adapter
was given the setting's values.

### D3 — A runtime change closes the session

`sessions.forTurn` reuses whatever active session the agent has, regardless of runtime
(`sessions/index.ts:41-58`). A `SessionRef` is one CLI's handle; handing a Claude session id to
Codex resumes nothing and, depending on the adapter, fails or silently starts fresh. Today this is
already reachable — `ensureConductor` rewrites `agents.runtime_id` when the config changes and
leaves the session alone — and the two settings make it a routine operation rather than a rarity.

`forTurn` gains the rule: if the active session's `runtime_id` is not the resolved runtime, mark it
`stale` and create a new one, and report `stale: true` so the turn prompt says the session
restarted (the same signal the idle-expiry path already produces). `sessions.reset` stops falling
back to `config.defaults.runtime` and uses the resolved setting.

### D4 — The parking card loses its runtime options

`run-recovery/stuck-worker-parking` specifies that a parked worker's decision offers "retrying on
each of the other runtimes available"; answering `runtime:<id>` writes `agents.runtime_id`
(`decisions/service.ts:185`). That is a per-agent override, which the owner ruled out, and it is
also the one path that could leave a single worker on a runtime nothing in the config names.

It is removed rather than redirected. Making the option write the workspace `workers` setting would
move every worker in the workspace onto another CLI to unstick one ticket — a much larger action
than the card's wording implies. The card keeps retry now, retry later and cancel, and its context
says that the runtime is a workspace setting and names it. The same removal applies to the
`runtime:` prefix in `decisions/service.ts` answer handling, including the hire card's
"Approve, but run on \<runtime\>" (`roles/index.ts:120`), which wrote `roles.runtime_id`.

This is the one place where the change removes a recovery affordance rather than a configuration
knob, which is why it is called out in the proposal.

### D5 — Migration runs in the loader, against the raw YAML

Zod strips unknown keys, so once `defaults.runtime` and friends leave the schema, an old
`workspace.yaml` parses cleanly and the old values vanish before any migration could see them. The
migration therefore reads the raw parsed YAML, before `WorkspaceConfigSchema`:

1. If the raw document already has a `models` block, nothing happens.
2. `models.conductor` ← the raw `conductor` block's `runtime`, `model` and `effort`, each falling
   back to the raw `defaults.runtime|model` and then to `claude`/`null`.
3. `models.workers` ← the runtime, model and effort of the workspace's roles, taken from the
   `roles` table (the live value; `defaults.runtime` is only what a new project inherits). Roles
   are counted by `runtime_id`, non-retired first; ties and the no-roles case fall back to the raw
   `defaults.runtime|model`, then to the conductor setting's runtime with a null model.
4. The derived block is written back through `saveConfig`, and the old keys disappear with it, so
   the migration runs once.
5. One `info` line records what was chosen and why: the two settings, the role runtime counts it
   saw, and which rule fired.

`loadWorkspace` opens the DB (`workspace/loader.ts:197`) before it builds the context, so the roles
table is readable at the point the migration needs it. The derivation itself is a pure function
`deriveModelSettings(rawConfig, roleRows)` in `packages/core/src/models/migrate.ts`, unit-tested
against the single-runtime, mixed-runtime, no-roles and already-migrated cases; the loader is the
only thing that does I/O.

### D6 — A mixed-runtime workspace is asked, not guessed

When step 3 sees roles on more than one runtime, the migration still writes the most common one —
the daemon must be able to run a turn — but records the disagreement in
`workspaces.settings_json` under `modelsMigration: { ambiguous: true, counts, chosen }`. Decisions
are a service that does not exist yet at load time, so raising the card is a separate step:
`services.models.reconcile()`, called from the per-workspace startup block in
`packages/server/src/daemon.ts:182` beside `jobs.reconcile()` and `ensureConductor`. It raises one
`question` decision owned by the human, correlated on `models:workers-runtime` so a restart cannot
raise a second, with one option per runtime the roles used and the chosen one recommended.
Answering it writes the setting and clears the flag.

### D7 — Which runtimes get probed

`usage/accounts.ts:42` derives the runtimes to probe by unioning `agents`, `projects` and `roles`.
Two of those tables lose the column, so the set becomes the runtimes the two settings name, unioned
with the distinct `runtime_id` of non-retired agents — a worker that started before a setting
change is still burning that runtime's quota until its turn ends, and its account is worth probing.

### D8 — Surfaces

**Web.** A `models` section replaces `conductor` in `SETTINGS_SECTIONS`
(`packages/ui/src/lib/settings.ts`), in the workspace area, holding both settings: for each, a
runtime `<select>` over `GET /runtimes` and a model control that is a `<select>` over
`GET /runtimes/:id/models` plus a free-text entry for a model the adapter does not list. The
Conductor section's only other content is a note about transcription, which moves to the workspace
section. The Team role sheet loses its runtime and model selects; the Onboarding flow keeps its one
conductor runtime/model step, renames it to cover both settings, and drops the per-project runtime
select.

**CLI.** `conductor models` prints both settings; `conductor models set conductor|workers
--runtime <id> --model <id|default> [--effort <e>]` writes one. `conductor conductor set-runtime`
and `set-model` are removed; `conductor role`/`project` lose their RUNTIME columns.

**API.** `GET /models` → `{ conductor, workers }`; `PUT /models` takes the whole block, parsed
through the schema and saved (the same whole-object contract `PUT /presentation` uses — a partial
body there silently drops blocks, and this block is small enough that a partial write buys
nothing). `PATCH /conductor` keeps `reset-session` company but loses `runtime|model|effort`.

## Risks

- **Blast radius.** Every one of `packages/{shared,db,core,server,cli,ui}` changes, and both test
  harnesses (`core/src/testing/context.ts`, `server/test/fakes.ts`) need the new `models` service or
  every unrelated test that reaches it throws synchronously. Mitigated by ordering the tasks
  schema-first and keeping the resolution function pure.
- **An operator's model choice is lost.** A workspace that deliberately ran one role on a cheap
  model loses that. It is the explicit intent of the request; the migration log names the role
  runtimes it saw so the loss is visible in the record.
- **DB column drops.** `ALTER TABLE … DROP COLUMN` needs SQLite ≥ 3.35; node:sqlite on Node 26 is
  well past it, and the migration is one-way — a rollback to the previous release would need its
  restore-from-backup path (`docs/OPERATIONS.md`), which `conductor daemon upgrade` already takes
  before migrating. Noted in the ADR.
