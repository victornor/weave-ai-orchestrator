## Context

See `proposal.md` — Why. `packages/core/src/models/resolve.ts` is the one place that decides an
agent's runtime and model (module doc comment: "There is one answer and one place it comes
from"). Inverting precedence there is small in line count and large in consequence: every
workspace on every daemon reads through it, and the schema gap that hides "unconfigured" from
"configured with defaults" has to close first or the inversion silently breaks every existing
workspace on the day it ships.

Read for this: `packages/shared/src/config.ts` (`ModelSettingSchema`, `WorkspaceModelsSchema`,
`DaemonModelsSchema`, `ModelsLockedSchema`, `toLegacySpelling`), `packages/core/src/models/{resolve,index,migrate}.ts`,
`packages/core/src/workspace/loader.ts` (`loadWorkspace`, `writeWorkspaceYaml`),
`packages/server/src/routes/{models,daemon}.ts`, `packages/ui/src/routes/Settings.tsx`
(`ModelsSection`, `DaemonModelsSection`, `OverlaySetting`), `openspec/specs/model-selection/*`.

## Goals / Non-Goals

**Goals:**
- The daemon's setting is the floor; a workspace's own configured setting rises above it.
- A workspace that has never touched its model settings does not silently start overriding the
  daemon the moment this ships, on a config file in the shape a real install has today.
- The worker-options catalog follows the same precedence, stated as whole-list not merged, with
  the reasoning stated once so it does not need re-litigating per setting.
- Workspace model controls are never disabled by anything the daemon holds.
- The daemon Models page keeps stating what default it provides.

**Non-Goals:**
- A workspace-side "you are currently overriding the daemon" indicator. Nothing in the acceptance
  criteria asks for it, and the ticket rules out UI work beyond making the controls editable.
- Listing every workspace currently overriding a filled daemon default, on the daemon Models
  page. Optional per the ticket; skipped (see Decision: what the daemon Models page states).
- Per-ticket worker-option precedence (still wins over both, unchanged).
- Any change to how a *daemon* overlay itself is filled or cleared — the existing inherit/override
  toggle on the daemon Models page is kept as the write path; only its wording and consequence
  change.

## Decisions

### The schema gap: make the workspace's own weaver/workers genuinely optional

`WorkspaceModelsSchema` (`packages/shared/src/config.ts:222`) currently declares:

```ts
export const WorkspaceModelsSchema = withKeyAlias(z.object({
  weaver: ModelSettingSchema.default({}),
  workers: ModelSettingSchema.default({}),
  workerOptions: WorkerOptionsArraySchema.default([]),
}), 'conductor', 'weaver');
```

`weaver`/`workers` lose their `.default({})`, becoming `ModelSettingSchema.optional()`. The outer
`models` field on `WorkspaceConfigSchema` keeps `.default({})`, so a config with no `models` key
at all still parses to `{ workerOptions: [] }` (weaver/workers absent). This is the option the
ticket calls out as cleanest (option 1 of the three offered): absence is a real, representable
state, not an object that happens to hold the schema's own defaults.

This is a **stored-config shape** change only. Every place that reads an *effective* value already
goes through `effectiveModels()`/`modelSettingFor()`/`modelsFor()`, whose return type is a
different, fully-filled type (kept as `WorkspaceModels`, unchanged) — because a resolved value
always has a runtime to launch on, whether it came from the workspace, the daemon, or the schema
default. The stored schema's inferred type is what changes; call it out at the type level rather
than reusing the same name for two different shapes: the stored, possibly-partial type stays named
`WorkspaceModels` (it is still literally `WorkspaceConfig['models']`'s type, which is what that
name has always meant structurally), and the resolved/effective type gets its own name,
`EffectiveModels`, returned by `effectiveModels()` and `ModelsService.get()`.

**Alternative considered (option 2, field-level merge):** let a workspace set only `effort` and
inherit the daemon's runtime and model for that same setting. Rejected: the existing precedence
(both today's and every other layer in this system — the worker-options catalog, a ticket's
option choice) is whole-object, not field-level; introducing field merge for exactly these two
settings would be a new kind of precedence nobody asked for, more surface for an operator to
reason about ("which half of my setting is mine and which is the daemon's?"), and does not match
any acceptance criterion — the criteria talk about "the workspace's setting" as a unit throughout.

### `effectiveModels()`, inverted

```ts
export function effectiveModels(
  daemon: { models?: DaemonModels } | null | undefined,
  workspace: Pick<WorkspaceConfig, 'models'>,
): EffectiveModels {
  const stored = workspace.models;
  const overlay = daemon?.models ?? {};
  return {
    weaver: stored?.weaver ?? overlay.weaver ?? DEFAULT_MODEL_SETTING,
    workers: stored?.workers ?? overlay.workers ?? DEFAULT_MODEL_SETTING,
    workerOptions: catalogFilled(stored?.workerOptions) ? stored!.workerOptions! : (catalogFilled(overlay.workerOptions) ? overlay.workerOptions! : []),
  };
}
```

`DEFAULT_MODEL_SETTING = ModelSettingSchema.parse({})` (`{ runtime: 'claude', model: null }`) is
the last-resort default, reached only when neither the workspace nor the daemon has configured a
control — identical to today's ultimate fallback, just reached by a different path.
`catalogFilled` is today's `catalogOverlayFilled` renamed to say what it actually tests now that
it is applied to both sides (`Array.isArray(x) && x.length > 0`); it is the same non-empty check,
not a new rule.

`DEFAULT_WORKSPACE_MODELS` (used as a fallback in `modelSettingFor` when `config.models` itself —
the whole effective object — is absent) is retyped `EffectiveModels` and built directly as
`{ weaver: DEFAULT_MODEL_SETTING, workers: DEFAULT_MODEL_SETTING, workerOptions: [] }` rather than
via `WorkspaceModelsSchema.parse({})`, since that parse would now yield `weaver`/`workers`
undefined.

### Worker-options catalog: whole-list, workspace-first, unmerged — same rule, swapped sides

Acceptance criterion 4 asks this to be stated explicitly. The catalog is a list of independently
identified, independently editable options (id, description, runtime, model, effort); merging two
catalogs by id would require deciding, per id, whose entry wins, whether a workspace can *remove*
a daemon-provided tier by omission or has to shadow it, and what happens to an id present on one
side but not the other. None of that has a non-arbitrary answer, and today's catalog precedence
is already whole-list (`catalogOverlayFilled`) — this change only swaps which side is checked
first, it does not introduce a new merge rule. A workspace that wants the daemon's tiers plus one
more copies them into its own catalog; that is more explicit than a silent per-id merge would be.

One consequence worth stating because it looks surprising at first: a **fresh daemon** (seeded per
`model-selection/fresh-install-defaults` with the three unconfigured tiers) and a **fresh
workspace** (empty catalog) resolve to exactly the same effective catalog — the daemon's three
tiers — as they do today. The inversion changes nothing about the common install-time case; it
only changes what happens once a workspace deliberately defines its own catalog.

### `modelsLocked` is deleted, not inverted

The ticket asks this to be a named decision. `modelsLocked()` exists today so the web app can grey
out a workspace control the daemon has taken away from it. Under the inversion, the daemon can no
longer take a control away — a workspace can always set its own value and it always wins — so
there is nothing left for "locked" to mean at the workspace API. Inverting it to mean "this
workspace is currently overriding the daemon" would be a new, purely informational feature: it
does not gate anything (nothing should be disabled), and the ticket's own "not in scope" section
rules out models-UI work beyond making controls editable. Building an unused boolean that some
future ticket might surface is exactly the kind of speculative surface this repo's conventions
argue against. Deleted: `ModelsLockedSchema`, `ModelsLocked`, `modelsLocked()`,
`ModelsService.locked()`, the `locked` field on `GET /models` and `PUT /models`, and
`ui/src/api/types.ts`'s `ModelsLocked`/`WorkspaceModels.locked`.

`ModelsService.set()` currently branches on `locked.weaver`/`locked.workers`/`locked.workerOptions`
to silently keep the stored value instead of writing `next`'s. That branch is deleted along with
it: every write to a workspace's models now writes what was asked, unconditionally (still through
`WorkspaceModelsSchema.safeParse` for validation, and `workerOptions` omitted still means "keep the
existing catalog" exactly as today — that half of the PUT contract is unrelated to locking and is
unchanged).

`packages/cli/src/commands/models.ts` reads the same `locked` field from `GET /models` to refuse
`models set`/`options add|set|remove` (`assertUnlocked`, a `conflict` telling the operator to use
`weave daemon models` instead) and to print a `(daemon)` mark next to a locked control in `models
show`. Both are removed for the same reason as the web app's disabled state: there is no longer a
locked control to refuse a write to or mark. `weave daemon models` (the daemon-overlay commands,
unaffected by this change) remains the way to fill or clear the daemon's default.

### What the daemon Models page states, and what it deliberately does not

The page's existing per-row control (`OverlaySetting` in `Settings.tsx`) already frames each of
the conductor and workers overlay rows as an explicit inherit/override choice, and already fills
the overlay seeded from a concrete value (a workspace's own setting when one is in context,
otherwise the runtime default) — this mechanism is kept as-is; it is how an operator fills or
clears the daemon overlay, and that write path does not change. What changes is what filling the
overlay *means*, so the copy describing it has to stop claiming something no longer true:

- The section's lead line ("Filled overlays apply to every workspace and disable the matching
  workspace Models fields. Empty means each workspace uses its own settings.") is rewritten to:
  "Filled overlays set the default every workspace starts from until it configures its own. Empty
  means the built-in default (claude, no model chosen) applies until either does."
- `OverlaySetting`'s hint ("Overrides every workspace." / "Inherits each workspace's own
  setting…") is rewritten to state the new relationship: filled → "The default every workspace
  uses until it sets its own."; empty → "No daemon default; each workspace's own setting is used,
  or claude with no model chosen if it has not set one either."
- The scope `<select>`'s "Override for every workspace" option label becomes "Set as the default
  for every workspace".

**Skipped, and named explicitly per the ticket's "say if you skip it":** showing, on this page,
*which* workspaces are currently overriding a filled default. That needs a query across every
workspace's stored config that nothing on this page runs today (`useModelsOptional()` reads only
the workspace currently in context, called out in the existing code comment as a VS-230
constraint — this page is reachable with no workspace in context at all). Building that query, and
deciding how to render a cross-workspace list on a page that today renders one workspace's preview
at a time, is more surface than "state what it is providing as the default" asks for. Not done
here; a follow-up ticket if an operator actually needs it.

### Compatibility: an existing `workspace.yaml` is not "unconfigured" just because a human never opened Settings — a migration is required, not just a schema fix

**This section replaces an earlier, wrong version of this design.** The first draft claimed a
workspace that "never opened Settings → Models" has no `models` key on disk at all, so the schema
fix alone would be enough. That is false, and it inverts the outcome on the one host this was
checked against: `initWorkspace` (`packages/core/src/workspace/loader.ts`) calls
`WorkspaceConfigSchema.parse({version: 1, id, name, ticketPrefix})` and writes the *parsed* result
— under today's schema that parse fills `weaver`/`workers` with `ModelSettingSchema`'s own
defaults (`{ runtime: 'claude', model: null }`) before it ever reaches disk. Every workspace that
exists today, whether or not a human ever touched its model settings, already has an explicit,
fully-populated `models` block written to `workspace.yaml`. The real host this runs on has gone
further: its stored `weaver`/`workers` hold `opus`/`sonnet`, values only reachable by way of a
past `PUT /models` — but per the point below, that write's timing does not matter to the fix,
only whether the *value currently in force* changes.

The concrete risk this create for VS-284: this host's daemon has `weaver: opus/high` and
`workers: opencode/deepseek-flash/high` filled — so today `workers` resolves to
`opencode`/`deepseek-flash` for every worker, daemon-wins. The moment this schema ships, without
anything else, the workspace's now-"present" `workers: claude/sonnet` would start winning instead
— captain's quick/standard tiers silently moving off deepseek-flash onto Sonnet, the exact
opposite of "the daemon setting is the default."

**Why clearing "byte-identical to the schema default" is not the fix (option 1, rejected):** this
host's stored values are `opus`/`sonnet`, not `claude`/`null` — a byte-identical-to-default check
would not touch them, and the regression above would still happen. It also does not generalize:
any workspace whose stored value happens to differ from the *current* schema default, for any
reason, would be missed by definition, even though the underlying problem — a value written while
the daemon was winning, never observed to have any effect — is identical.

**The fix: a one-time migration that preserves the value already in force, not the bytes already
on disk.** Under today's precedence, `ModelsService.set()` already refuses to persist a write to a
control the daemon has locked (`packages/core/src/models/index.ts`: `weaver: locked.weaver ?
stored.weaver : next.weaver`) — so a workspace's stored value for a currently-daemon-filled
control cannot be a deliberate choice made *while* that control was locked; it can only be
whatever was already there before the daemon filled it, or `initWorkspace`'s baked-in default. In
both cases that stored value has had **zero observable effect** for as long as the daemon overlay
has been filled. Clearing it changes nothing a human has seen; leaving it in place, once the
workspace's own value can win, changes what every affected agent runs on without anyone asking for
that.

So: at load, once per workspace, for each of `weaver`, `workers` and the worker-options catalog,
if the workspace has a stored value for that control **and** the daemon's overlay for that same
control is filled at that moment, the workspace's stored value is cleared (not merged, not
compared to a default — cleared outright), leaving the daemon overlay in force exactly as it was
before this change. A control whose daemon overlay is *not* filled at that moment is left
untouched — it was already the effective value, under both the old and the new precedence, so
there is nothing to reconcile. This is implemented in `model-selection/settings-migration`'s
existing home, `packages/core/src/models/migrate.ts` (see "Where this migration lives" below), and
runs once, gated by its own meta-table flag, the same pattern `hasModelSettings`/
`ROLE_RUNTIMES_META_KEY` already uses for the VS-77 migration in `loader.ts`. A workspace that
configures a control itself *after* this migration has run is a deliberate choice and is never
cleared again — the flag is set once and never re-evaluated.

**Where this migration lives.** `packages/core/src/models/migrate.ts` already holds the VS-77
one-time migration (`deriveModelSettings`/`hasModelSettings`/`ModelMigration`), invoked from
`loader.ts`'s `loadWorkspace()` and specified under `model-selection/settings-migration`. That is
the right home for this migration too — same file, same capability, a sibling one-time step (call
it `demaskWorkspaceModels`, gated by its own meta key, e.g. `vs284_masked_settings_cleared`) rather
than a new subsystem. It runs after VS-77's migration (so it always sees the two-settings shape)
and before `effectiveModels()` is first computed for that load, using the same `opts.daemon` the
loader already has in hand at that point. It logs what it cleared and what now governs in its
place, at `info` level, so an operator can see why a workspace's effective setting is what it is
without having to notice a config diff.

Going forward this class of bug does not recur: because the schema fix removes `.default({})` from
`weaver`/`workers`, a workspace created *after* this change ships has no stored value to fill or
clear in the first place until a human actually configures one through `PUT /models` — `initWorkspace`
no longer bakes anything in. The demasking migration exists purely to settle the installed base
that predates it.

#### Rollback (VS-263's still-standing rule)

`toLegacySpelling` destructures `config.models.weaver` into the legacy `conductor` key and
serializes the rest with `YAML.stringify`. When `weaver` is `undefined` (a control the demasking
migration cleared, or a freshly created workspace that was never configured), the key is omitted
from the written YAML (the `yaml` package drops `undefined`-valued keys rather than writing
`null`). A pre-VS-284 daemon reading that file already treats a missing key as "use the schema
default" via its own `.default({})` — the same behavior it always had, and on a workspace the
demasking migration touched, that schema default is `claude`/no model, not the daemon overlay the
pre-rollback daemon was actually applying; a rollback is a known, accepted loss of the daemon's
current overlay value for that specific control until it is re-filled or the workspace reconfigures
it, not a silent behavior change nobody can see (`weave daemon models show` still shows the overlay
unchanged; only the workspace's own record of what it used to store is gone). A workspace that
*has* configured its own setting (before or after the migration) writes it explicitly either way,
so a rollback reads back exactly what it wrote before. Verified with a round-trip test
(`toLegacySpelling` → `YAML.stringify` → `YAML.parse`) asserting the key is absent, not `null`, for
an unconfigured control.

## Risks / Trade-offs

- [Risk] A caller somewhere still reads `ctx.config.models.weaver` directly, expecting it always
  to be a `ModelSetting`, and gets `undefined` at runtime once the default is dropped →
  Mitigation: grepped every direct `.models.weaver`/`.models.workers`/`.models.workerOptions`
  access across `packages/core` and `packages/server` during design; the only direct accesses
  outside `resolve.ts`/`migrate.ts` already operate on an *effective* (fully-filled) value, never
  the stored config. `pnpm typecheck` after the schema change is the enforcement: a stored-shape
  access that assumed non-optional will fail to compile, not fail silently at runtime.
- [Risk] `ModelsService.set()`'s current signature accepts `WorkspaceModelsPut | WorkspaceModels`
  (the latter for `settleWorkersRuntime`'s "answer a migration question" call, which spreads
  `ctx.config.models`). That workspace always has a fully-derived, non-optional `models` block by
  construction (it just went through `deriveModelSettings`), so this path is unaffected in
  practice; call this out with a comment at that call site rather than widening the type, so the
  precondition is not silently lost if that code moves.
- [Trade-off] Deleting `modelsLocked` rather than inverting it means a future "show me what's
  overriding what" feature starts from nothing. Accepted: building it unused now is the kind of
  speculative surface the repo's conventions call out against, and the ticket explicitly permits
  deletion as an outcome.
- [Risk] The demasking migration reads `opts.daemon` at the moment a workspace happens to load, and
  clears based on that snapshot. If the daemon's config were somehow read before it finished
  loading, the migration could see an empty overlay that is about to be filled and skip clearing a
  now-genuinely-masked value → Mitigation: this is not a new risk this change introduces —
  `effectiveModels(opts.daemon, config)` a few lines later in the same `loadWorkspace()` already
  depends on `opts.daemon` being the daemon's real, fully-loaded config at that point; daemon config
  is loaded once at process start before any workspace is loaded, and nothing in this codebase
  loads a workspace before the daemon config it references exists. The migration and every other
  reader of `opts.daemon` share the same precondition.
- [Risk] Getting the demasking migration wrong is not cosmetic on this codebase's own daemon: it
  would move real worker traffic off `deepseek-flash` onto `sonnet` with nothing announcing it,
  exactly the regression this section exists to prevent → Mitigation: the acceptance test for this
  migration is written against this host's actual shape (`weaver: opus/opus`, `workers:
  claude/sonnet` stored on the workspace; `weaver: opus/opus/high`, `workers:
  opencode/deepseek-flash/high` on the daemon) and asserts the effective `workers` setting is
  `opencode`/`deepseek-flash` both immediately before this change ships and immediately after,
  across the migration boundary — not just "some value," the specific one already in force.
