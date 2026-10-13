# ADR 0011 — Model selection is two per-workspace settings

**Status:** accepted · 2026-09-07 · supersedes the runtime and model fields of PLAN §5, §6 and §8 · amended by ADR 0023 (a ticket may name a catalog option; the two settings remain the defaults) and ADR 0024 (optional daemon overlays)

## Context

PLAN §5 gives `workspace.yaml` a `defaults.runtime` and `defaults.model`, a per-project `runtime`,
and a `conductor` block with its own `runtime` and `model`. PLAN §6 gives `projects` a `runtime_id`
and `model`, `roles` a `runtime_id`, `model` and `effort`, and `agents` the same three. PLAN §8.1
describes `listModels()` as feeding "the model dropdown for every agent incl. the conductor".

Five layers, resolved as a chain. The engine read a turn's model as
`agent.model ?? role.model ?? config.defaults.model`, falling through to whatever the CLI itself
picks, and its runtime as `agent.runtime_id` — copied from `role.runtime_id` at spawn, which was
copied from `project.runtime_id` at hire, which was copied from `defaults.runtime` at project add.
Four surfaces could write a runtime (project add, hire, the Team page, the hire card's "approve, but
run on codex") and a fifth could write one per agent (the parking card's "retry on codex").

Nothing displayed the resolved answer, so the layers were invisible until they disagreed. On
2026-09-07 this workspace's conductor ran on Fable and every worker on Opus 5, because
`conductor.model` was set and `defaults.model` was null. Nothing was misconfigured; the chain simply
had two endpoints. The owner asked for two settings and nothing else.

## Decision

`workspace.yaml` holds one `models` block with exactly two settings, each `{ runtime, model,
effort? }`:

```yaml
models:
  conductor: { runtime: claude, model: claude-fable-5-1 }
  workers:   { runtime: claude, model: claude-opus-5, effort: high }
```

The weave runs on `models.conductor`; every worker in the workspace runs on `models.workers`,
whatever its role or project. `modelSettingFor(config, kind)` is the only reader, and there is no
fallback behind it other than letting the runtime choose when `model` is null.

Everything else goes: `defaults.runtime|model`, `conductor.runtime|model|effort`,
`projects[].runtime|model` and their columns, `RoleSpec.runtime|model|effort` and their columns, and
`agents.model|effort`. `POST /roles/:id/activate` takes no body, `PATCH /conductor` is gone, and
`POST /projects` no longer accepts a runtime.

`agents.runtime_id` stays as a record of what an agent is currently on — the worker pages show it,
the usage view groups by it, and the account probe reads it — but is written from the setting and
never read to decide. `runs.runtime_id` and `runs.model` describe the run that happened.

Three consequences worth stating outright:

- **`effort` survives, inside the two settings.** The claude, codex and opencode adapters each turn
  it into a CLI flag (`--effort`, `model_reasoning_effort=`, `--variant`), so dropping it would have
  changed how every turn runs in a workspace that set one, silently.
- **The parking card loses its per-runtime retry options.** Answering `runtime:<id>` wrote
  `agents.runtime_id`, which is the per-agent override this ADR removes. The card keeps retry now,
  retry later or at the reset time, and cancel, and names the workers setting as where the runtime is
  changed. Pointing the option at the workspace setting instead was rejected: it would move every
  worker in the workspace onto another CLI to unstick one ticket.
- **Changing a setting's runtime retires that agent's session.** A `SessionRef` belongs to the CLI
  that issued it, so `forTurn` starts a new session rather than handing a Claude session id to Codex.

## Migration

Migration `0012_model_settings.sql` stashes the roles' runtimes into `meta` before dropping the
columns, and the loader consumes that row: it reads the **raw** YAML — Zod strips unknown keys, so
the old values are gone from a parsed config — derives the conductor setting from the old `conductor`
block and the workers setting from the runtime and model the roles actually used, writes the result
back through `saveConfig`, and logs what it chose with the role runtime counts.

A workspace whose roles used more than one runtime gets the most used of them, so turns can still
run, plus one `question` decision owned by the human asking which runtime the workers setting should
hold. `models.reconcile()` raises it at startup, correlated so a restart cannot raise a second.

The column drops are one-way. `weave daemon upgrade` takes a database backup before migrating,
so a rollback to an earlier release restores from it (`docs/OPERATIONS.md`).

## Why not

- **Per-role or per-ticket overrides, kept as an escape hatch.** Explicitly rejected by the owner:
  the point of the change is that there is nothing to check but two settings.
- **`defaults.models`.** Nesting a workspace-level fact under a block named for inheritance is the
  shape being removed.
- **Deriving the workers setting from `defaults.runtime`.** That was only what a *new* project
  inherited; the roles table holds what the workspace was really running on.
