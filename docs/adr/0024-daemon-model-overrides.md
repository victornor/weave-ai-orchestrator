# ADR 0024 — Daemon model overlays

**Status:** accepted · 2026-09-10 · amends ADR 0011 and ADR 0023 (the two workspace settings and the
workspace catalog remain; a filled daemon overlay is the effective value for that control on every
workspace) · amended by ADR 0019 (a missing `daemon.yaml` is seeded with three unconfigured tiers;
an existing file is never rewritten)

## Context

ADR 0011 made model selection exactly two workspace settings. ADR 0023 added a workspace catalog a
ticket may name. A daemon that hosts many workspaces then repeats the same conductor model, workers
default, and named options in every `workspace.yaml`. Captain asked on 2026-09-10 for optional
daemon-level overlays: when filled, every workspace uses those values and workspace Settings for
that control is disabled; when empty, per-workspace Settings work as today.

## Decision

`daemon.yaml` may hold `models: { conductor?, workers?, workerOptions? }`, each optional and
independent. A present conductor or workers setting, or a non-empty `workerOptions` list, is a
filled overlay. Absent, null, and `workerOptions: []` are empty.

`effectiveModels(daemon, workspace)` is applied before `modelSettingFor`. Workspace yaml is not
rewritten while an overlay is in force; clearing the overlay restores the stored workspace values.

`GET /models` returns the effective block plus `locked: { conductor, workers, workerOptions }`.
`PUT /models` ignores locked keys. `GET`/`PUT /api/daemon/models` is the overlay writer (same
in-place `deps.daemon` mutation as transcription). Roles, projects and agent rows still cannot
choose a runtime or a model.

## Why not

- **Model-id-only overlays.** Model ids are not portable across runtimes; VS-77 settings are
  `{ runtime, model, effort? }`.
- **All-three-or-nothing.** The request was per matching control.
- **Baking the overlay into `ctx.config.models` at load.** `PUT /models` would then write daemon
  values into workspace yaml.
