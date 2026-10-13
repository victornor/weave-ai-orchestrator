## Context

See `proposal.md` for motivation. Today `ModelSettingSchema.runtime` is `z.string().min(1).default('claude')` and `WorkerModelOptionSchema` extends it, so every option names a runtime and an omitted one becomes `claude`. `model: null` already means "the runtime picks". `DaemonModelsSchema` defaults to empty overlays; `readDaemonConfig` on a missing file returns `parse({})` and does not write. `startDaemon` reads that, mkdir's the config dir, and only writes `daemon.yaml` later when a route persists something.

`catalogOverlayFilled` is a non-empty array. `modelSettingFor` returns `{ runtime, model, effort? }` from a named option without asking whether runtime is set. Ticket create/assign reject unknown ids only. The catalog editor (`WorkerOptionsEditor` in `packages/ui/src/routes/Settings.tsx`) can add and remove rows, not edit them. `AppShell` already mounts `ConnectionBanner` under the header; `useDaemonModels` already hits `GET /api/daemon/models` and is mocked empty in Settings tests. VS-230 put daemon Models at `/settings?section=daemon-models`.

## Goals / Non-Goals

**Goals:**

- Nullable runtime on worker options only, with a named refuse path that cannot become `claude`.
- First-boot write of `daemon.yaml` when the file is absent, seeding the three tiers.
- In-place runtime/model on catalog rows, plus an app-wide non-dismissible banner driven by the daemon overlay.

**Non-Goals:**

- Unconfiguring the conductor or workers *settings*, or changing how they default to `claude`.
- A setup wizard, onboarding flow, or blocking the rest of the UI.
- Migrating existing `daemon.yaml` files, including ones with no `models` key.
- Telegram / TUI banners (refusal is server-side).
- Changing overlay fill/lock semantics beyond the first-boot seed.

## Decisions

### D1 — Nullable `runtime` on `WorkerModelOptionSchema` only

```ts
export const WorkerModelOptionSchema = ModelSettingSchema.extend({
  id: slug,
  description: z.string().min(1).max(200),
  runtime: z.string().min(1).nullable().default(null),
});
```

`null` (and an omitted key, which this default turns into `null`) is unconfigured. A string is configured. `model: null` keeps its meaning. `ModelSettingSchema.runtime` stays required-with-default-`claude` for conductor and workers settings.

Rejected: a `configured: boolean` flag (two ways to be unfinished, easy to desync). Rejected: nullable runtime on `ModelSettingSchema` itself (would unconfigure conductor/workers by accident and break every fixture that relies on `parse({})` → `claude`). Rejected: empty-string runtime (`min(1)` already forbids it; null is the explicit unset).

Export `isWorkerOptionConfigured(opt): opt is ConfiguredWorkerOption` as `opt.runtime != null` so UI, ticket validation, and `modelSettingFor` share one predicate.

### D2 — `model_unconfigured` is a new error code, not `runtime_unreachable`

Add `'model_unconfigured'` to `ERROR_CODES`. HTTP 400 via the `validation` status mapping (or its own 422 — prefer 400 next to `validation`, since the operator's config is incomplete, not a missing host CLI). Message names the option id and that no runtime is chosen. Details: `{ optionId }`.

`resolveWorkerModelId` rejects unconfigured ids the same way it rejects unknown ones, but with this code. `modelSettingFor` throws `OcError('model_unconfigured', …)` when the named option exists and is unconfigured — it does **not** return `{ runtime: 'claude' }` and does **not** fall back to `models.workers`. Engine/dispatcher/spawn already convert thrown `OcError` / tagged errors into a failed run; map this code through so the turn record carries `model_unconfigured`.

Rejected: reusing `runtime_unreachable` (that means a named adapter is not installed; here nothing was named). Rejected: falling back to workers (the silent path captain forbade).

Deleted / unknown id still falls back to workers (ADR 0023, unchanged).

### D3 — Seed in `startDaemon` when the file is absent, not as a Zod default

`DaemonConfigSchema.parse({})` keeps empty overlays so in-memory tests and `readDaemonConfig` of an existing file without `models` stay empty.

Extract `ensureFreshDaemonConfig(dir): DaemonConfig` next to `readDaemonConfig` in `packages/core/src/workspace/loader.ts`:

- file exists → `readDaemonConfig(dir)` unchanged
- file missing → `writeDaemonConfig(DaemonConfigSchema.parse({ models: { workerOptions: DEFAULT_WORKER_TIERS } }), dir)` and return that

`DEFAULT_WORKER_TIERS` lives in `packages/shared/src/config.ts`: the three objects, descriptions verbatim, `runtime: null`, `model: null`. Id remains `quick`.

`startDaemon` calls `ensureFreshDaemonConfig` instead of `readDaemonConfig` so the in-memory `deps.daemon` is the seeded object and every workspace overlay-reads it without a restart.

Rejected: putting the three tiers in `DaemonModelsSchema`'s default (every existing install whose yaml omitted `models` would suddenly lock workspace catalogs). Rejected: seeding from `readDaemonConfig` on every missing file (CLI reads before first start would write as a side effect; the write belongs to daemon start).

### D4 — Banner is app-wide, failed-tone, daemon-overlay-driven

A `ModelsUnconfiguredBanner` mounts in `AppShell` next to `ConnectionBanner`. Visible when `(useDaemonModels().data?.workerOptions ?? []).some(o => o.runtime == null)`. Copy: worker adapters are not chosen yet; choose them in daemon Settings → Models before running workers. Control: `A` / `go('/settings', { search: { section: 'daemon-models' } })`. Classes: `bg-failed/10 text-failed`, `h-banner`, `role="status"`. No dismiss.

Workspace-only unconfigured options (daemon overlay empty) do not drive this banner; they still refuse at the server. Fresh deploy is the daemon overlay.

### D5 — Catalog rows become editable; add-form still prefers a runtime

Shared `WorkerOptionsEditor`: each existing row shows runtime and model pickers (reuse `ModelSettingFields` / the runtime select). Saving a row PUTs the whole catalog with that option updated. Unconfigured row: runtime control shows an explicit empty/"Not chosen" value, not `claude`. Model disabled until runtime is set.

The add form keeps seeding its runtime draft from `current.workers.runtime` so a newly added option is typically configured. The schema still accepts `runtime: null` if a caller writes it.

### D6 — ADR amendment, not a silent PLAN rewrite

New ADR 0019 (next free after 0018): unconfigured worker options and the fresh-install seed. Amend ADR 0023 (runtime no longer always set on an option) and ADR 0024 (first-boot catalog overlay is filled without the operator). PLAN §5 notes the seed and nullable option runtime. `docs/API.md` documents `runtime: null` on worker options and `model_unconfigured`.

## Risks / Trade-offs

- **[Risk]** First `startDaemon` now writes `daemon.yaml` (full schema defaults + the three tiers) where today a missing file stays missing until some other persist. → Mitigation: only when the file is absent; existing files including `version: 1` with no models are untouched. Tests that currently boot a daemon against an empty dir must expect the file and the three options, or write a stub yaml first.
- **[Risk]** Tickets with no `workerModelId` still launch on the workers setting (`claude`). → Accepted: out of scope. The banner tells the operator to finish the tiers; the refuse path is using an unconfigured *tier*.
- **[Risk]** Conductor lists unconfigured options and might still pass their id. → Create/assign reject; tool description says not to. Better than hiding the tiers so the conductor invents ids.
- **[Risk]** `WorkerModelOption.runtime: string | null` ripples through UI types and `workerOptionRuntimes`. → Filter with `isWorkerOptionConfigured`; existing `.filter(Boolean)` already drops null.

## Migration Plan

No migration of existing installs. Deploy the build; daemons with a `daemon.yaml` boot as today; a brand-new config dir gets the seed on first start. Rollback is revert: a seeded file that an operator has not edited would keep the three unconfigured options on disk (harmless; overlay filled but unused if they never file onto them) — they can clear the overlay in daemon Models.

## Open Questions

None. Representation, seed site, banner placement, and what clears the warning are decided above.
