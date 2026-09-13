## Context

`effectiveModels` (`packages/core/src/models/resolve.ts`) already resolves each control
independently: `stored?.weaver ?? overlay.weaver ?? DEFAULT`, and the same for `workers`, with
`workerOptions` using the stored catalog when non-empty and the daemon's otherwise. Storage already
supports inherit: `WorkspaceModelsSchema.weaver`/`workers` are optional, and the daemon overlay
clears a control with `null` (`PUT /api/daemon/models`).

The gap is entirely in the workspace write and read API:

- `WorkspaceModelsPutSchema` requires both `weaver` and `workers`, and `models.set` always writes
  both. `PATCH /config` deep-merges and cannot delete a key, so there is no way to clear one control.
- `GET /api/w/:ws/models` returns only effective values, so no client can tell an inherited value
  from a pinned value that happens to equal it.
- Every existing writer sends the whole effective block (`{ ...current, [field]: next }` in the CLI;
  `useSetModels` in the UI), so each edit pins the control it did not touch.

VS-348 shipped V2 Settings against that limitation: `v2/settings/override.ts` compares values to
decide `inherited`/`overridden`, and "reset to daemon" writes the daemon's current value — so an
override on one agent freezes the other agent's value, and the workspace stops following later
daemon changes for the agent it never overrode. Its design.md (Open Questions, follow-up) names this
ticket as the fix.

## Goals / Non-Goals

**Goals:**

- A workspace can override one control and inherit another, independently, through storage, API and
  every client.
- A client can read back, per control, whether the value is the workspace's, the daemon's or the
  default, and can clear a control back to inherit.
- Existing bodies and consumers keep working unchanged.
- V2's override UI is driven by the real source, not by comparing values.
- V1 and the CLI stop pinning the control they did not change.

**Non-Goals:**

- Changing resolution precedence (`model-selection/turn-resolution`) — it is already per field.
- Changing the daemon overlay endpoints (`model-selection/daemon-overrides`).
- Changing the stored shape of `WorkspaceModels` on disk.
- A database migration: nothing persisted changes shape.

## Decisions

### 1. The source is computed in core and returned additively, not folded into `EffectiveModels`

`EffectiveModels` is the resolved value the turn engine and `modelSettingFor` consume; giving it a
`source` field would put a read-only presentation concern into the resolution path and force every
construction site to carry it. Instead a sibling `modelsSource(stored, daemon)` in `resolve.ts`
computes `{ weaver, workers, workerOptions }` of `'workspace' | 'daemon' | 'default'`, and the route
returns `{ ...effective, source }` as a new `WorkspaceModelsView`.

`ModelsService.get()` and `set()` return the view; the one internal consumer
(`weave_worker_models`) reads only `.workers`/`.workerOptions` and is unaffected. The route's
`GET` and `PUT` both return the view so a client that replaces its cache with the write response
does not lose the source.

- **Alternative:** add `source` to `EffectiveModels`. Rejected: it is not an effective value, and it
  would leak into `modelSettingFor` and the run engine.
- **Alternative:** a separate `GET /models/source` endpoint. Rejected: the source belongs with the
  value it describes and one round trip is enough.

### 2. `PUT` is per control, and `null` is the clear sentinel (the daemon's own idiom)

`WorkspaceModelsPutSchema` becomes `weaver`/`workers`: `ModelSettingSchema.nullish()`, and
`workerOptions`: `WorkerOptionsArraySchema.nullish()`. `models.set` merges over the stored block:

- `undefined` (omitted) keeps the stored control;
- `null` clears it (stored key set to `undefined`, which the workspace YAML omits);
- a value sets it;
- `workerOptions` `null` or `[]` stores an empty catalog, which resolution already treats as
  inherit.

This mirrors `PUT /api/daemon/models` (`{ [field]: null }` clears) so both layers of the same
feature read the same way. `set` keeps accepting `EffectiveModels` too (an `EffectiveModels` carries
every control as a value, so it sets all three); this keeps `settleWorkersRuntime` working
unchanged. The restamp, login-pause release, activity and event writes stay exactly where they are.

- **Alternative:** a `DELETE /models/:control` verb or a `PATCH` with JSON Merge Patch semantics.
  Rejected: the daemon overlay already established `null` as the clear sentinel, and a body that
  carries `null` is what both the CLI and UI can send without a second request.

### 3. `workerOptions` inherit is catalog-level

A workspace's catalog is all-or-nothing: `catalogFilled` already treats a non-empty stored list as
the workspace's override and an empty one as "use the daemon's". So the source reports
`'workspace'` for a non-empty stored catalog and `'daemon'`/`'default'` otherwise, and clearing it
is `workerOptions: null` (stored empty). This is why V2's per-option override UI becomes
catalog-level: the operator overrides the whole catalog (seeded from the daemon's list) and resets
it as a whole. It also matches V1, which has always treated the workspace catalog as an owned list.

### 4. V2 derives state from source; the diff still needs the daemon's values

`v2/settings/override.ts`'s `agentOverrideState`/`optionOverrideState`/`countOverrides` are replaced
by reading `source`. The diff footer still needs the daemon's values to name what differs, so
`WorkspaceModelsSection` keeps its `useDaemonModels()` read for the baseline text only; the
inherited/overridden decision comes from `source`. The banner counts the controls the source map
marks `'workspace'` (the weaver, the workers, and the catalog), using the same map the tags use.
The copy describing the pinning trade-off is removed.

### 5. V1 stays minimal: partial writes, a source line, one clear action

`ModelsSection`'s two `set`/`commit` paths send `{ [kind]: next }` only, and the worker-options
editor sends `{ workerOptions: [...] }`. Each agent gets a short source line and a "Use daemon
default" button when its source is `'workspace'`, which sends `{ [kind]: null }`. No new V1 layout.

### 6. CLI mirrors the daemon command tree

`weave models set <agent>` sends only the named control. `weave models inherit
<conductor|workers|options>` clears one control (`null`), mirroring `weave daemon models set
--clear`. `weave models show` prints each control's source alongside its value.

## Migration Plan

None. `WorkspaceModels` on disk is unchanged; only the wire body gains optional nullable fields and
the read gains an additive `source`. Old two-field `PUT` bodies keep working because the new schema
treats absent keys as "keep" and the values as sets. Rollback is reverting the branch; a workspace
that inherited a control stays inherited (its stored YAML never gained the key).

## Risks / Trade-offs

- **The GET response grows a field.** Additive, but tests that assert the exact response object must
  add `source`. Listed in tasks.
- **`workerOptions: []` now means clear, as it did before**, while omission means keep. The V1/V2
  editors must send the array explicitly on every catalog edit, which they already do.
- **V2 worker options change from per-option to catalog-level override.** This is the behavior the
  API can actually store, and the ticket asks for it; the design.md copy that described the
  value-comparison workaround is removed with it.
- **`jsdom` cannot judge the accent border.** The V2 tests assert the tag text, the write bodies and
  the banner count; the border class is covered by the existing `border-accent-edge` contract.
