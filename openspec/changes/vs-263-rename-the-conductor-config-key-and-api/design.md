## Context

See proposal.md for the full field table and why VS-259 left this surface behind. This design covers
how the rename is implemented without breaking a `workspace.yaml` or `daemon.yaml` an operator
already has on disk, and without requiring a database migration (nothing here is a column value —
VS-259 already owns all of those).

Two structurally different storage shapes are in play, and they need different treatment:

1. **Files parsed fresh on every load** — `workspace.yaml`, `daemon.yaml`, and every `PUT` request
   body. These go through a `zod` schema's `.parse()`/`.safeParse()` every time, so a schema-level
   fix is complete: it governs every past and future read.
2. **A DB column holding pre-validated JSON, read raw without re-parsing** — `projects.policies_json`.
   `ProjectPoliciesSchema` validates it once, at write time (project add/update); after that, several
   call sites (`packages/core/src/tickets/service.ts:258` `approvalOwner()`,
   `packages/core/src/decisions/service.ts:63` and `:71` inside `defaultOwner()`) read the column
   directly via a SQL join and cast it to a plain TS type, never touching the schema again. A schema
   fix alone cannot reach a value already sitting in that column under the old spelling.

VS-259's worker anticipated case 2 and left it half-done: `APPROVAL_OWNERS` (`enums.ts:40`) is still
`['human', 'conductor', 'none']`, and both read sites above already carry a `raw === 'conductor' ?
'weaver' : raw` translation, commented as waiting on this ticket.

## Goals / Non-Goals

**Goals:**
- Every field in proposal.md's table reads correctly under either spelling, and refuses loudly when a
  single record carries both. Every live wire response (`PUT /models`, `PUT /api/daemon/models`, the
  locked-state response) writes only the new spelling. A **persisted** file or record that a
  pre-VS-263 daemon binary could still read after a rollback — `workspace.yaml`, `daemon.yaml`, a role
  spec file's `createdBy`, a project's stored `policies_json` — keeps writing the *old* spelling for
  now, deliberately (Decision 6); this is a considered exception to "write the new spelling," not an
  oversight.
- No caller-side special-casing at every `safeParse`/`parse` call site — the alias behaviour lives in
  the schema itself, so `loader.ts`, the route handlers, and every test fixture keep calling
  `Schema.parse(raw)` exactly as they do today.
- `RoleSpecSchema.partial().strict()` (used by the role-patch route and `roles/index.ts`) keeps
  working — the alias mechanism must not turn a `ZodObject` into something `.partial()` can't be
  called on, for any schema something else calls a `ZodObject`-only method on.

**Non-Goals:**
- No database migration. `projects.policies_json` keeps whatever bytes it already has; only the *read*
  side changes (already done, per Context).
- No rewrite of an existing `workspace.yaml`/`daemon.yaml`/role file as a side effect of loading it.
  Per Decision 6, a write to one of those files does not introduce the new spelling either, for now —
  it re-serializes under the same old spelling it already had.
- No change to `agents.kind`, `decisions.owner`, or the per-workspace directory name (VS-259/VS-258).
- No change to the `conductor` CLI binary name, `@agent-conductor/*` package names, or CLI-vocabulary
  prose (`conductor models set conductor|workers`, `packages/surfaces/herdr`'s process marker,
  `chatPrefs`/`dictationDiagnostics` event names) — none of those are a config key or a wire field.
- No rename of the `workers.conductor()` service method or its call-site local variables. That is a
  code-identifier cleanup with a much larger blast radius (supervisor, routes, projects, routines,
  knowledge, tickets — a dozen-plus call sites) and is not itself a config key or an API field; left
  for a future ticket if wanted.

## Decisions

### Decision 1: Key-level aliasing is a schema wrapper, not a caller-side normalization step

Two approaches were considered for the renamed *keys* (the top-level `conductor`/`weaver` block,
`models.conductor`/`weaver`, `defaults.conductorDigestIntervalSec`/`weaverDigestIntervalSec`,
`presentation.conductor`/`weaver`):

- **(a) Caller-side**: a plain function (mirroring `packages/release/src/paths.ts`'s
  `resolveInstallPath`) that every `loadWorkspace`/`readDaemonConfig`/route handler calls on the raw
  object before handing it to `Schema.safeParse()`.
- **(b) Schema-level**: a small `withKeyAlias(schema, oldKey, newKey)` wrapper composed directly into
  each affected schema's definition in `config.ts`, so `Schema.safeParse(raw)` already does the right
  thing with no caller change.

Chose **(b)**. `paths.ts` is a leaf package that deliberately throws plain `Error`s because it has
nothing else to throw — `packages/shared` already has `OcError` and an established
`safeParse` → `{success:false}` → `OcError('validation', …)` idiom used at every call site (`loader.ts`
lines 210-213, 339-340; `http.ts`'s `body()` helper). Reusing that idiom means the "both present"
refusal (Decision 2) surfaces as an ordinary validation error with no new error-handling path for any
caller to learn, and every existing test fixture (`WorkspaceConfigSchema.parse({...})`,
`DaemonConfigSchema.parse({...})`) keeps working unchanged for the common case.

`withKeyAlias` is built from two composed zod primitives and was verified directly against the zod
version this repo pins (3.25.76), not assumed from the zod docs:

```ts
function withKeyAlias<S extends z.ZodTypeAny>(schema: S, oldKey: string, newKey: string) {
  return z.any().superRefine((raw, ctx) => {
    if (isPlainObject(raw) && oldKey in raw && newKey in raw) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `both '${oldKey}' and '${newKey}' are present; keep only one` });
    }
  }).transform((raw) => {
    if (isPlainObject(raw) && oldKey in raw && !(newKey in raw)) {
      const { [oldKey]: v, ...rest } = raw;
      return { ...rest, [newKey]: v };
    }
    return raw;
  }).pipe(schema);
}
```

Verified live (not guessed) in a `packages/shared` node REPL against the installed zod:
- old-key-only, new-key-only, and neither all resolve to the same parsed value.
- both-keys-present fails `safeParse` with `{success:false}` (a custom `ZodIssue`, not an uncaught
  throw — confirmed a plain `throw` inside `.preprocess()` propagates *past* `safeParse` uncaught,
  which is why this uses `superRefine` + `transform` + `pipe` rather than a throwing `preprocess`).
- composes correctly when the wrapped schema already has `.default({})` applied on top, and when the
  *inner* object schema itself already ends in `.refine(...)` (as `WorkspaceDefaultsSchema` does, for
  `handoverQuietMinutes < handoverAbandonTimeoutMinutes`) — the refine still runs and still sees the
  post-alias field names.
- `.partial()`, `.extend()`, `.shape`, `.pick()`, `.omit()`, `.merge()`, `.strict()`, `.passthrough()`
  are never called on any of the six schemas being wrapped (`WorkspaceConfigSchema`,
  `WorkspaceDefaultsSchema`, `WorkspaceModelsSchema`, `WorkspaceModelsPutSchema`, `DaemonModelsSchema`,
  `DaemonModelsPutSchema`, `PresentationConfigSchema`) anywhere in the repo (checked by grep) — so
  wrapping them (turning them from `ZodObject` into a `ZodPipeline`) is safe. `RoleSpecSchema` **is**
  used with `.partial().strict()` (`roles/index.ts:163`, `routes/roles.ts:29`), which is exactly why
  `createdBy`'s alias is handled as a value-preprocess on that one field (Decision 3), never by
  wrapping the whole `RoleSpecSchema` object.

### Decision 2: Both spellings present is a refused, loud validation error

Same policy as `path-compatibility`'s `resolveInstallPath` (VS-258): a silent pick would be exactly
the failure class the ticket calls out — "parses with the conductor's model setting silently gone."
Refusing loudly is cheap here (it is one more `ZodIssue`, not a new mechanism) and consistent, so
there is only one idiom for "which spelling wins" across the whole codebase: none does, together.

Alternative considered: prefer the new key and log a warning when both are present. Rejected — the
ticket explicitly asks not to invent a second idiom next to VS-258's, and a warning that scrolls past
in a log is exactly the kind of silent-until-it-isn't failure this whole three-ticket effort exists to
stop repeating (VS-250 is cited in the ticket for how long a wrong model setting can run unnoticed).

### Decision 3: Value-level aliases (`createdBy`, `APPROVAL_OWNERS`) are a field-level `z.preprocess`, not a key alias

`createdBy: 'conductor'` and `proposalApproval`/`taskApproval`/`hireApproval: 'conductor'` are enum
*values*, not key names — a single field cannot hold two values at once, so there is no "both present"
ambiguity to refuse, and no need for `withKeyAlias`'s object-level machinery. Each becomes:

```ts
createdBy: z.preprocess((v) => (v === 'conductor' ? 'weaver' : v), z.enum(['human', 'weaver'])).default('weaver'),
```

and `APPROVAL_OWNERS` moves from `['human', 'conductor', 'none']` to `['human', 'weaver', 'none']`,
with the same preprocess wrapping `ProjectPoliciesSchema.proposalApproval`/`taskApproval` and
`WorkspaceDefaultsSchema.proposalApproval`/`hireApproval`. This keeps `RoleSpecSchema` and
`ProjectPoliciesSchema`/`WorkspaceDefaultsSchema` as plain `ZodObject`s (Decision 1's constraint) since
only one field's schema changed, not the containing object's.

### Decision 4: `projects.policies_json`'s raw-read call sites are correct as they stand and are not touched

`tickets/service.ts:264-266` and `decisions/service.ts:63-65,71-75` already do the value-alias
translation directly against the raw DB column, because that column is validated only at write time
(project add/update) and several read sites join it straight out of SQL without ever calling
`ProjectPoliciesSchema.parse()` again. Renaming `APPROVAL_OWNERS`'s value doesn't touch these — they
compare against the plain string literal `'conductor'`, not the enum — so they need no code change,
only their comments updated to drop "VS-263's deferred config-key surface" language now that it is no
longer deferred. This is deliberate, not an oversight: a schema-level fix genuinely cannot reach a
value that is never re-parsed, so the correct fix for that path is exactly the inline translation
already there, once (per Decision 3) the *schema* also accepts the old value wherever a policy blob
**is** re-validated (a fresh project add, a policy PATCH, a fresh `workspace.yaml` load for the
workspace defaults case).

### Decision 5: No wire-skew handling beyond what the file/DB case already provides

The ticket asks for an explicit answer on `PUT /api/daemon/models`, `PUT /models`, and the
locked-state response, not just silent acceptance. The web UI is served by the daemon itself
(`packages/server/src/static.ts` serves `packages/ui/dist`), and the `conductor` CLI is "the new
release's CLI" restarted from the same release directory as the daemon
(`docs/OPERATIONS.md`: `current -> releases/<stamp>-<sha>` is "what the service and the `conductor`
wrapper run"). Both clients are always built from, and always run from, the exact same commit as the
daemon they talk to — there is no independent-upgrade path for either that could send an old-shaped
body to a new daemon or vice versa. The one moment a version gap exists during an upgrade — the new
release's CLI polling `/api/health` on the still-running old daemon while restarting it — never calls
a models or config route, only health.

Because of that, `WorkspaceModelsPutSchema`/`DaemonModelsPutSchema` get exactly the same
`withKeyAlias` treatment as the on-disk schemas (Decision 1) for consistency and defence-in-depth (a
hand-crafted `curl` request, a future non-shipped-together client), but this is not covering a live
skew scenario — there isn't one. `ModelsLockedSchema` is constructed fresh by the server on every
request (never parsed from external input), so it is renamed straight to `weaver` with no alias
wrapper: nothing ever needs to *read* it under the old name.

### Decision 6: Persisted files keep writing the old spelling for now; only the wire canonicalizes immediately

The first draft of this design (see git history) wrote `weaver` everywhere, on the reasoning that
this was "the same rollback exposure every prior rename ticket in this series already accepted." That
reasoning does not hold up: VS-258's `resolveInstallPath` is resolve-only and never writes a new name
into an existing install, so a rollback after it was always safe; VS-259 is a database migration,
covered by the pre-upgrade snapshot the upgrade pipeline already takes. Neither precedent applies
here. Writing `weaver` into `workspace.yaml`/`daemon.yaml`/a role file/`policies_json` and then rolling
back to a pre-VS-263 daemon is a **new** exposure this ticket would introduce: the old binary's schema
has never heard of `weaver`, so the field falls back to its default — exactly the silent-model-setting-
loss failure the ticket's own VS-250 citation warns about, and live rather than theoretical, since
captain runs `daemon rollback` and is about to perform a significant upgrade.

Three options were weighed for what a write emits, for each artifact that could still be read by a
rolled-back pre-VS-263 daemon (`workspace.yaml`, `daemon.yaml`, a role file's `createdBy`, a project's
`policies_json`):

- **(A) Write only `weaver`.** Simplest, and what "newly written configuration uses the new spelling"
  literally asks for — but it is exactly the newly-introduced rollback exposure above. Rejected: a
  silent settings loss on a live, imminent rollback path outweighs finishing the rename a ticket early.
- **(B) Keep writing the old spelling on these specific artifacts; internal code and every read path
  still fully move to `weaver`.** Fully rollback-safe: an old binary reads back exactly the bytes it
  always wrote. Costs a small, one-directional "rename back before serializing" step at two functions
  (`loader.ts`'s `saveConfig` and `writeDaemonConfig`, which every other writer of `workspace.yaml`/
  `daemon.yaml` already funnels through) plus `roles/index.ts`'s `writeRoleFiles`. The rename is "not
  fully done" only in the narrow sense that these specific bytes on disk stay old for now.
- **(C) Write both spellings, kept in sync.** Also rollback-safe, and arguably "more done" than (B)
  since the new spelling is present too — but it collides with Decision 2 as written (both spellings
  present is *always* refused) and can only be reconciled by weakening that refusal to "refused only
  when the two spellings disagree," which then needs its own equal-value-comparison logic, its own
  tests, and roughly doubles the write-side surface (every governed field needs to be written twice,
  symmetrically, forever, or until something decides to stop). Rejected: the reconciliation is real
  work for a benefit — "more done"-ness — that (B) does not actually need to claim yet.

Chose **(B)**, scoped precisely: it applies only to artifacts that *persist across a code rollback*.
The two wire endpoints (`PUT /models`, `PUT /api/daemon/models`) and the locked-state response do
**not** persist anything — a rollback restores the daemon binary, not an in-flight HTTP response — so
they have no rollback exposure at all and canonicalize to `weaver` immediately, satisfying "newly
written configuration uses the new spelling" in full for the wire, and by deliberate exception, not
yet for the six governed fields that persist: `workspace.yaml`'s top-level block, `models.*` (in both
`workspace.yaml` and `daemon.yaml`), `weaverDigestIntervalSec`, `presentation.*`, a role file's
`createdBy`, and `APPROVAL_OWNERS` (`proposalApproval`/`taskApproval`/`hireApproval`, stored in a
project's `policies_json`).

This is temporary and bounded, not an indefinitely-deferred TODO: it should be revisited (flip
`saveConfig`/`writeDaemonConfig`/`writeRoleFiles`/the project-policy write to stop reverting the
spelling) once rolling back to a pre-VS-263 daemon is no longer an operationally live concern —
captain's call, once this change has been running long enough that a rollback past it is no longer on
the table. That is a follow-up ticket, not part of this one.

**A draft of this decision carved `APPROVAL_OWNERS` out as safe to write `weaver` immediately, and
that carve-out was wrong.** The reasoning was that VS-259's worker had already shipped an idempotent
`raw === 'conductor' ? 'weaver' : raw` read-site translation for it
(`tickets/service.ts:266`) — true, but incomplete: that is only one of three read sites for these
fields on `main` today. `decisions/service.ts`'s two translations for `hireApproval` and
`proposalApproval` are **not** idempotent —

```ts
return ctx.config.defaults.hireApproval === 'conductor' ? 'weaver' : 'human';   // decisions/service.ts:65
return owner === 'conductor' ? 'weaver' : 'human';                              // decisions/service.ts:75
```

— both collapse *any* value that is not literally `'conductor'` to `'human'`. A stored `'weaver'`
would read back through these as `'human'`, not `'weaver'`: after this ticket writes
`proposalApproval: 'weaver'` and a rollback follows, plan and hire approvals configured to belong to
the weaver would silently reroute to the human. Mild in direction (more oversight, not less) but
silent and unintended — exactly the failure class this whole decision exists to avoid, and it would
have made this document's own "what a rollback does: nothing" claim false for this one field.

A full sweep (`rg` for `proposalApproval`/`taskApproval`/`hireApproval` across `packages/`, not just
the two files VS-259's comments pointed at) found no fourth read site and confirmed `taskApproval` is
declared in the schema and in CLI help text but has no decision-routing read site at all yet — so
nothing else depends on this field's spelling either way. Rather than repair the two non-idempotent
shims (real, but it means the rename's correctness now depends on three independent read sites
agreeing, forever, for no benefit this ticket needs), **`APPROVAL_OWNERS` gets the same legacy-write
treatment as the other five fields, with no exception.** This makes Decision 6 one uniform rule —
*everything that persists keeps its old spelling for now; everything on the wire renames
immediately* — and it means this ticket does not have to touch or reason about `decisions/service.ts`'s
already-merged logic at all, which is its own kind of safe.

## Risks / Trade-offs

- [A schema wrapped in `withKeyAlias` is no longer a `ZodObject`] → Verified by grep that none of the
  six wrapped schemas has a `.partial()`/`.extend()`/`.shape`/`.pick()`/`.omit()`/`.merge()`/`.strict()`
  call anywhere in the repo; `RoleSpecSchema`, which does need `.partial().strict()`, is not wrapped —
  only its one `createdBy` field is.
- [Missing an internal `.conductor` → `.weaver` call site leaves a `TS2551`/runtime `undefined`] →
  `tsc -b` catches every renamed-field access at compile time (strict mode, no `any` survives); the
  full call-site list is enumerated in tasks.md from a repo-wide grep, not left to be discovered by
  the compiler alone.
- [`presentation.conductor` was missed by the ticket's own inventory once already] → Re-swept the
  whole repo for the literal (see proposal.md's Impact section and this design's Context) rather than
  trusting the ticket's table as exhaustive, the same lesson VS-259 recorded for its own inventory.
- [Forgetting to apply Decision 6's legacy-write step at one of the four write points (`saveConfig`,
  `writeDaemonConfig`, `writeRoleFiles`, the project-policy write) would quietly reopen the rollback
  exposure this decision exists to close] → Each gets a test asserting the on-disk/DB bytes it
  produces still carry the *old* spelling for its governed field(s) (not just that reading them back
  works), listed explicitly in tasks.md rather than left to be noticed later.
- [A carve-out that assumes one grep hit represents every read site is exactly how the first draft of
  this decision got `APPROVAL_OWNERS` wrong] → Any future change to what gets written for a governed
  field re-sweeps every read site of that field first (not just the ones a prior ticket's comments
  happened to point at), the same lesson `presentation.conductor` already taught this ticket once.

## Migration Plan

No database migration. Deploy is a normal merge + `conductor daemon upgrade`: the next daemon boot
loads existing `workspace.yaml`/`daemon.yaml` files exactly as before (old spelling still accepted).
Per Decision 6, a subsequent config write (a settings change, an internal migration, a role update, a
project-policy change) re-serializes `workspace.yaml`, `daemon.yaml`, role files, and `policies_json`
under the *same old spelling they already had* — this is deliberate, not a gap, and is the reason
rollback stays safe. Only the two `PUT` responses and the locked-state response move to the new
spelling immediately, and they carry nothing across a rollback to lose.

**Rollback**, `conductor daemon rollback`, is fully safe under this design, uniformly: every persisted
artifact a rolled-back daemon might read — `workspace.yaml`, `daemon.yaml`, role files,
`policies_json` — is byte-for-byte what that daemon would have written itself, because a post-VS-263
daemon never writes anything different into any of them. No artifact's safety here depends on a
rolled-back binary having a translation shim of any kind; the daemon rollback path itself needed no
change.

**Report to captain (delivery note):** after this ships, `workspace.yaml`/`daemon.yaml`/role files,
and a project's stored approval-owner policy, still say `conductor:`/`createdBy: conductor`/
`proposalApproval: conductor` on disk — that is intentional, not a partial rollout. The API and web
app already speak `weaver` everywhere. Rolling back to the immediately-prior daemon build is safe with
no special precaution needed, for every field this ticket touches. The follow-up to flip the on-disk
spelling is intentionally not filed by this ticket; it is a one-line-per-call-site change whenever
rollback-past-this-point stops being an operational concern.
