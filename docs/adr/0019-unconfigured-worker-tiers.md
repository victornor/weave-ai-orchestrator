# ADR 0019 — Unconfigured worker tiers on a fresh daemon

**Status:** accepted · 2026-09-11 · amends ADR 0023 and ADR 0024 (a catalog option may now have
`runtime: null`; a missing `daemon.yaml` is seeded with three such options; existing files are never
rewritten)

## Context

ADR 0023 added a named catalog a ticket may point at. ADR 0024 moved that catalog to an optional
daemon overlay. `WorkerModelOptionSchema` extended `ModelSettingSchema`, whose `runtime` defaulted
to `claude`, so an option with no adapter silently became Claude. Captain asked for a fresh
deployment to ship `quick`, `standard` and `deep` with no adapter chosen, and for that state to
refuse to run rather than work by accident.

`model: null` already means "the runtime picks". Unconfigured has to be a distinct representation.

## Decision

`WorkerModelOptionSchema.runtime` is `string | null`, default `null`. `isWorkerOptionConfigured`
is `runtime != null`. `ModelSettingSchema` is unchanged: conductor and workers still default to
`claude`.

`DEFAULT_WORKER_TIERS` is the three options with captain's verbatim descriptions and
`runtime: null` / `model: null`. It is not a Zod default on `DaemonModelsSchema`.
`ensureFreshDaemonConfig` writes it only when `daemon.yaml` is absent. An existing file, including
`version: 1` with no `models` block, is left alone.

`modelSettingFor` and `resolveWorkerModelId` throw `model_unconfigured` (HTTP 400) when the named
option exists and is unconfigured. A missing, unknown, or deleted id still falls back to
`models.workers`. The engine finalizes with that code and starts no runtime.

The web app shows an undismissable failed-tone banner while any daemon overlay option has
`runtime == null`, linking to `/settings?section=daemon-models`. Catalog rows are editable in
place so those options can be configured without deleting them.

## Why not

- **A setup-complete flag beside a still-required runtime.** The silent-claude default would remain
  the stored value; the flag would be a second source `modelSettingFor` is not allowed to have.
- **Seeding via `DaemonConfigSchema.parse({})`.** Existing installs without a `models` block would
  lock the three unconfigured tiers on next boot.
- **Migrating existing overlays.** Captain asked for a starting point, not a rewrite of configured
  daemons.
