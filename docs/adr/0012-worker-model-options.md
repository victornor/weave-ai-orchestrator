# ADR 0012 — Named worker model options, picked per ticket

**Status:** accepted · 2026-09-09 · amends ADR 0011 (the two settings remain; a ticket may name a catalog id) · amended by ADR 0013 (the catalog a ticket names is the effective catalog after a daemon overlay)

## Context

ADR 0011 made model selection exactly two workspace settings and forbade per-ticket overrides. On
2026-09-09 captain asked for several worker models, each with a when-to-use description, so the
conductor can pick a cheaper model for a scout and a stronger one for a backend-heavy change
(VS-162; motivation also VS-159).

A free runtime/model on the ticket, or a per-role list, would bring back the chain ADR 0011 removed.
The exception is narrower: a workspace-defined catalog, and a ticket that points at one id in it.

## Decision

`workspace.yaml`'s `models` block keeps `conductor` and `workers` as the defaults. It gains
`workerOptions`: `{ id, description, runtime, model, effort? }[]`, empty by default.

A ticket may store `workerModelId`, set at create or at assign while it has no worker. After spawn
the id is sticky. `modelSettingFor(config, kind, ticket?)` looks the id up; a missing, unknown, or
deleted id falls back to `models.workers`. Unknown id at write time is rejected.

`PUT /models` omits `workerOptions` → keep the existing catalog; an explicit array (including `[]`)
replaces it. Roles, projects and agent rows still cannot choose a runtime or a model.

Live lookup: editing an option applies on the next turn of tickets that name it, matching VS-77.

## Why not

- **Replacing `models.workers` with `{ default, options }`.** Breaks every two-setting client and test.
- **Snapshotting runtime/model onto the ticket.** A second source `modelSettingFor` is not allowed to have.
- **Injecting the catalog into bootstrap.** VS-159; the conductor lists via `ac_worker_models` when filing.
