## 1. Shared schema foundations

- [x] 1.1 In `packages/shared/src/config.ts`, add the `withKeyAlias(schema, oldKey, newKey)` helper
      from design.md Decision 1 (`superRefine` + `transform` + `pipe`, not a throwing `preprocess`)
      and a small `isPlainObject` guard it needs; export `withKeyAlias` so `config.test.ts` can hit it
      directly. Verify with a standalone unit test on a toy schema: old-key-only, new-key-only,
      neither, and both-present (expect `safeParse` to return `{success:false}` with an issue naming
      both keys, not a thrown exception).
- [x] 1.2 Wrap `WorkspaceModelsSchema`, `WorkspaceModelsPutSchema`, `DaemonModelsSchema`,
      `DaemonModelsPutSchema` with `withKeyAlias(..., 'conductor', 'weaver')`, renaming each schema's
      own field to `weaver`. Verify: `config.test.ts` parses `{ conductor: {...} }`,
      `{ weaver: {...} }`, and rejects `{ conductor: {...}, weaver: {...} }` for each of the four.
- [x] 1.3 Rename `ModelsLockedSchema`'s `conductor` field to `weaver` with a plain rename (no alias
      wrapper — design.md Decision 5: it is server-constructed, never parsed from external input).
      Verify: `config.test.ts` asserts the type shape; grep confirms nothing calls
      `ModelsLockedSchema.parse`/`safeParse` on externally-sourced data.
- [x] 1.4 Wrap the top-level `conductor: { channels, heartbeatIntervalSec, humanName }` block in
      `WorkspaceConfigSchema` with `withKeyAlias(..., 'conductor', 'weaver')`, field renamed to
      `weaver`. Verify: `WorkspaceConfigSchema.safeParse` accepts both spellings at the top level and
      rejects both-present; confirm `.safeParse`/`.parse` (the only methods called on this schema
      anywhere in the repo, per design.md) still work everywhere without a caller change.
- [x] 1.5 Wrap `defaults.conductorDigestIntervalSec` inside `WorkspaceDefaultsSchema` the same way,
      field renamed to `weaverDigestIntervalSec`, applied *before* the schema's existing
      `.refine(handoverQuietMinutes < handoverAbandonTimeoutMinutes)`. Verify: both spellings parse to
      the same value, both-present is rejected, and the existing handover-minutes refine still fires
      (add/keep a test asserting the refine still rejects `handoverQuietMinutes >=
      handoverAbandonTimeoutMinutes` after the wrap).
- [x] 1.6 Wrap `PresentationConfigSchema`'s `conductor: PresentationBlockSchema.optional()` field the
      same way, renamed to `weaver`. Verify: a parse with legacy `conductor` block resolves to
      `.weaver`.
- [x] 1.7 Change `RoleSpecSchema.createdBy` to
      `z.preprocess((v) => (v === 'conductor' ? 'weaver' : v), z.enum(['human', 'weaver'])).default('weaver')`
      (design.md Decision 3 — a value preprocess on one field, not a `withKeyAlias` wrap, so
      `RoleSpecSchema` stays a plain `ZodObject`). Verify: `RoleSpecSchema.parse({..., createdBy:
      'conductor'})` yields `'weaver'`; `RoleSpecSchema.partial().strict().safeParse(...)`
      (`roles/index.ts:163`, `routes/roles.ts:29`) still typechecks and runs.
- [x] 1.8 In `packages/shared/src/enums.ts`, change `APPROVAL_OWNERS` from
      `['human', 'conductor', 'none']` to `['human', 'weaver', 'none']`. In `config.ts`, wrap
      `ProjectPoliciesSchema.proposalApproval`/`taskApproval` and
      `WorkspaceDefaultsSchema.proposalApproval`/`hireApproval` with the same
      `'conductor' -> 'weaver'` value preprocess as 1.7. Verify: each of the four fields accepts
      legacy `'conductor'` and resolves to `'weaver'` in-process. This field's write side is not done
      here — group 2 (`toLegacySpelling` and the project-policy write) reverts it back to `'conductor'`
      before anything is persisted, on the same terms as every other governed field, per design.md
      Decision 6.
- [x] 1.9 Add a fixture-based regression test in `packages/shared/src/config.test.ts` (or a new
      `config.legacy.test.ts`) built from a real pre-change shape — a `workspace.yaml` body modeled on
      what this ticket's own filing quotes as the live file's `models:` block (`conductor:` at the
      position it described), not a hand-simplified object — asserting `WorkspaceConfigSchema.parse`
      recovers every setting from it, including `models.weaver`. This is the acceptance-criterion-5
      test naming this workspace's own live config shape; a worker cannot read the actual live
      `~/.config/agent-conductor/workspaces/.../workspace.yaml` (outside the worktree, and reading a
      live install's config is against this project's own rules), so the fixture is built from the
      ticket's description of that file's shape, called out as such in a comment.
- [x] 1.10 Run `pnpm vitest run packages/shared` and confirm every schema test (new and pre-existing)
      passes; commit this task group (`git commit` — schema-layer rename is the foundation everything
      else in this ticket builds on, and VS-259/VS-267 both hit the 45-minute turn cutoff, so land
      compiling work incrementally rather than at the very end).

## 2. Write-side legacy serialization (design.md Decision 6 — rollback safety)

This group exists because of two rounds of plan-review feedback partway through propose:
`workspace.yaml`, `daemon.yaml`, role files, and a project's stored policy (`policies_json`) must all
keep writing the **old** spelling for now, uniformly and with **no exception**, even though everything
else in this ticket reads and works with `weaver`. An earlier revision of this task group carved
`APPROVAL_OWNERS` out as safe to write `weaver` immediately; that was wrong — two of its three read
sites (`decisions/service.ts`) are not idempotent for a stored `'weaver'` — and the carve-out is gone.
Do not reintroduce it.

- [x] 2.1 In `packages/shared/src/config.ts`, add a small `toLegacySpelling(config: WorkspaceConfig):
      unknown` function: the inverse rename of tasks 1.4-1.6 (`weaver` → `conductor` at the top level,
      `models.weaver` → `models.conductor`, `defaults.weaverDigestIntervalSec` →
      `defaults.conductorDigestIntervalSec`, `presentation.weaver` → `presentation.conductor`), **plus**
      the inverse value-preprocess from task 1.8 for `defaults.proposalApproval`/`defaults.hireApproval`
      (`'weaver'` → `'conductor'`, since these two live inside `workspace.yaml`'s `defaults:` block and
      are covered by this same function, not by task 2.4 below). Also add a matching
      `daemonConfigToLegacySpelling(config: DaemonConfig): unknown` for `models.weaver` →
      `models.conductor`. Verify: a unit test round-trips a `WorkspaceConfig`/`DaemonConfig` built with
      `weaver` fields (including `defaults.proposalApproval: 'weaver'`) through
      `toLegacySpelling`/`daemonConfigToLegacySpelling` and asserts the output object has `conductor`
      keys and values, not `weaver` ones, at every governed path.
- [x] 2.2 `packages/core/src/workspace/loader.ts`: in `saveConfig` (the one function every config write
      funnels through — settings changes, the telegram-allowlist migration, the model-settings
      migration), call `toLegacySpelling(validated)` immediately before `writeYamlFile(file, ...)`,
      not before `ctx.config = validated` (the in-memory value stays canonical `weaver`; only the bytes
      written to disk are legacy). Apply the same to `initWorkspace`'s `writeYamlFile(file, config)`
      call, and to `writeDaemonConfig` (via `daemonConfigToLegacySpelling`). Verify: a new test writes
      a workspace/daemon config via each of these three functions and reads the raw YAML file back
      (not through the schema) to assert it contains `conductor:`/`models: { conductor: ... }`/
      `proposalApproval: conductor`, never `weaver` at those paths — this is the literal test for
      design.md's "Rollback is fully safe" claim, and for the spec requirement "A file or record that
      could still be read by prior code keeps its existing spelling on write, for now."
- [x] 2.3 `packages/core/src/roles/index.ts`: in `writeRoleFiles`, revert `spec.createdBy` from
      `'weaver'` to `'conductor'` before `YAML.stringify(spec, ...)` (a tiny local transform, not
      `toLegacySpelling` — `createdBy` is a value alias, not a key rename, per design.md Decision 3).
      Verify: hiring or patching a role writes a `role.yaml` whose `createdBy:` line is literally
      `conductor`, read back as raw YAML text, not through `RoleSpecSchema`.
- [x] 2.4 `packages/core/src/projects/index.ts`: at its two `policiesJson: ...` writes (project add
      ~line 160, project update ~line 314), revert `proposalApproval`/`taskApproval` from `'weaver'`
      back to `'conductor'` (a small local value transform on the policies object, mirroring 2.3 —
      `hireApproval` lives in `WorkspaceDefaultsSchema`, not `ProjectPoliciesSchema`, so it is task
      2.1/2.2's concern, not this one) before it lands in the DB. Verify: a test adds/updates a project
      with `proposalApproval`/`taskApproval` set from either spelling and asserts the DB's
      `policies_json` stores `'conductor'`, not `'weaver'`, in both cases.
- [x] 2.5 Run `pnpm vitest run packages/shared packages/core` and confirm every new and pre-existing
      test passes; commit this task group before moving to the internal `.conductor` → `.weaver`
      call-site sweep (group 3), since it is the part of this ticket most likely to be second-guessed
      in review and easiest to lose if a turn is cut off mid-way.

## 3. Core package internal call sites

- [x] 3.1 `packages/core/src/workspace/loader.ts`: rename `config.conductor.humanName` (line ~194) and
      `models.conductor.runtime` (line ~281) to `.weaver`. Verify: `pnpm vitest run
      packages/core/src/workspace` passes.
- [x] 3.2 `packages/core/src/models/resolve.ts` and `packages/core/src/models/migrate.ts`: rename
      every `.conductor` property access on a `WorkspaceModels`/`DaemonModels`/overlay-typed value to
      `.weaver` (the object literals `{ conductor: ... }` these functions build become
      `{ weaver: ... }`); update the `WorkersRule` union member `'conductor'` and the doc comment at
      `resolve.ts:5`. Verify: `pnpm vitest run packages/core/src/models` passes, including the
      migration tests that exercise `deriveModelSettings`.
- [x] 3.3 `packages/core/src/models/index.ts`: rename the `WorkspaceModelsSchema.safeParse({
      conductor: ..., workers: ..., workerOptions })` call site (in `set()`) and the `{ conductor:
      m.models.conductor, ... }` return in the migration-summary helper to `.weaver`. Verify:
      `pnpm vitest run packages/core/src/models` passes.
- [x] 3.4 `packages/core/src/prompts/index.ts`: rename `ctx.config.conductor?.humanName` to
      `ctx.config.weaver?.humanName`. Verify: `pnpm vitest run packages/core/src/prompts` passes
      (including `render.test.ts`, which currently sets `conductor: { ..., humanName: undefined }` on
      a test context — update that fixture too).
- [x] 3.5 `packages/core/src/usage/accounts.ts`: rename `models.conductor.runtime` to
      `models.weaver.runtime`. Verify: `pnpm vitest run packages/core/src/usage` passes.
- [x] 3.6 Update the now-resolved comments in `packages/core/src/tickets/service.ts` (~line 258) and
      `packages/core/src/decisions/service.ts` (~lines 63, 71) that say "VS-263's deferred config-key
      surface" — per design.md Decision 4, the inline `raw === 'conductor' ? 'weaver' : raw`
      translations in both files stay exactly as they are (they read `projects.policies_json` raw,
      which is never re-parsed through the schema), only the comment wording changes to state that the
      schema-level fix has landed and this translation is the permanent bridge for values already
      stored under the old spelling, not a stopgap. Verify: read the diff — no logic changed, only
      comment text.
- [x] 3.7 Grep `packages/core/` for any remaining `.conductor` access tied to this rename
      (`rg -n "\.conductor\b" packages/core/src --type ts`) and confirm every remaining hit is either
      the `workers.conductor()` service method/its call-site variables (out of scope, design.md
      Non-Goals) or already renamed. Commit this task group once `pnpm vitest run packages/core`
      passes in full.

## 4. Server package: routes, response shapes, docs

- [x] 4.1 `packages/server/src/routes/daemon.ts`: rename `DaemonModelsView`'s `conductor` field and
      every reference to it (~lines 214, 220, 228-229, 256, 262) to `weaver`.
      Verify: `pnpm vitest run packages/server` (daemon routes tests) passes.
- [x] 4.2 `packages/server/src/routes/models.ts`: confirm the `WorkspaceModelsPutSchema` body parse
      needs no route-level change (the alias lives in the schema per task 1.2) and update any
      response-shaping code that names `conductor` explicitly. Verify: `pnpm vitest run
      packages/server` (models route tests) passes, including a new test that `PUT /models` with a
      legacy `{ conductor: {...} }` body is accepted, the HTTP response's field is `weaver` (wire
      canonicalizes immediately), **and** the resulting `workspace.yaml` on disk still says
      `conductor:` (group 2's legacy-write behaviour) — do not assert the on-disk value is `weaver`,
      that would contradict design.md Decision 6.
- [x] 4.3 `packages/server/src/channels.ts`: rename `this.ctx.config.conductor.channels` (~line 69,
      including its doc comment) to `.weaver.channels`. Verify: `pnpm vitest run packages/server`
      (channels tests, including `channels.test.ts`'s `ctx.config.conductor.channels` fixture writes —
      update those too) passes.
- [x] 4.4 Update `docs/API.md`: the `PUT /models`, `PUT /api/daemon/models`, and models-locked-state
      response bodies now document `weaver`, with a short note that the field also accepts `conductor`
      on the way in for backward compatibility, and a note that the underlying `workspace.yaml`/
      `daemon.yaml` files are not rewritten to the new spelling yet (design.md Decision 6). Verify:
      read the diff against the actual route schemas from task group 1 — the documented shape matches
      exactly.
- [x] 4.5 Commit this task group once `pnpm vitest run packages/server` passes in full.

## 5. Presenter package

- [x] 5.1 `packages/presenter/src/reconcile.ts` and `packages/presenter/src/index.ts`: rename
      `desired.config.conductor` to `desired.config.weaver` (both the `conductorCfg` assignment and
      the `PresentationBlockView` fallback chain). Verify: `pnpm vitest run packages/presenter`
      passes.

## 6. CLI package

- [x] 6.1 `packages/cli/src/commands/models.ts`: rename the `WorkspaceModels`/local-type `conductor`
      field references (interface fields, `KINDS` array, `assertUnlocked`'s control union,
      `mark(...)` calls) to `weaver`, keeping the printed label text a deliberate, separate decision:
      per proposal.md's Not-Changed list, the *displayed* CLI vocabulary (what a human reads/types,
      e.g. `conductor models set conductor|workers`) is VS-260's job, not this ticket's — so keep the
      command argument string and printed label as `'conductor'` for now, and only rename the
      TypeScript field/type plumbing that carries the wire value. Verify: `pnpm vitest run
      packages/cli` (models command tests) passes.
- [x] 6.2 `packages/cli/src/commands/daemon.ts`: rename `DaemonModelsView`'s `conductor` field (~line
      360) and its reads (~lines 375, 391) the same way — field/type renamed, printed/typed CLI
      vocabulary (`'conductor' or 'workers'` in the error message, the `--setting` argument value)
      left alone per the same reasoning as 6.1. Verify: `pnpm vitest run packages/cli` (daemon models
      command tests) passes.
- [x] 6.3 `packages/cli/src/commands/presentation.ts`: rename `config?.['conductor']` (~line 43) to
      `config?.['weaver']` since it reads the schema field renamed in task 1.6; the printed row label
      may stay `'conductor'` for the same reason as 6.1, or move to `'weaver'` if that reads better
      next to the renamed key — pick one and be consistent with 6.1/6.2's choice. Verify: `pnpm vitest
      run packages/cli` (presentation command tests) passes.
- [x] 6.4 Commit this task group once `pnpm vitest run packages/cli` passes in full.

## 7. Web UI

- [x] 7.1 `packages/ui/src/api/types.ts`: rename the `conductor` field in the UI's own duplicated
      `ModelsLocked`, `WorkspaceModels`, and `DaemonModels` interfaces to `weaver`.
- [x] 7.2 `packages/ui/src/routes/Settings.tsx`: update every read/write site that names `conductor` on
      those types (`locked.conductor`, `current.conductor`, `set('conductor', ...)`,
      `save.mutate({ conductor: ... })`, `config.conductor` for the presentation block, etc.) to
      `weaver`; user-visible label text ("Conductor" section heading, hints) is prose, not the wire
      field, and is left alone per proposal.md's Not-Changed list unless it reads confusingly next to
      the renamed prop — judgement call, keep it minimal.
- [x] 7.3 `packages/ui/src/routes/Onboarding.tsx`: update the `PUT /models` and `PATCH /config` request
      bodies (~lines 208-209) to send `weaver` instead of `conductor`.
- [x] 7.4 Verify: `pnpm --filter @agent-conductor/ui exec vitest run` passes, including
      `settings*.test.tsx`/`onboarding.test.tsx` fixtures that currently assert on a `conductor` key in
      a posted body or rendered prop — update those fixtures to `weaver`. Commit this task group.

## 8. Whole-repo verification and delivery

- [x] 8.1 `rg -n "\.conductor\b|conductor:|'conductor'" --type ts --type tsx -g '!*.test.ts'
      -g '!*.test.tsx' packages/` and confirm every remaining hit is one of: the `workers.conductor()`
      service method and its call-site variables, the `conductor` CLI binary/package name, CLI
      argument/label vocabulary deliberately deferred to VS-260 (tasks 6.1-6.3), the deliberate
      legacy-write spellings added in group 2, or a `conductor:` window/event marker unrelated to
      config (herdr, chatPrefs, dictationDiagnostics) — all Non-Goals or Decision 6 exceptions per
      design.md. Anything else found here that isn't one of those categories gets fixed before moving
      on.
- [x] 8.2 `pnpm lint` clean.
- [x] 8.3 `pnpm typecheck` clean (`tsc -b` first, catches every unrenamed `.conductor` access as a
      compile error per design.md's stated risk mitigation).
- [x] 8.4 `pnpm test` — post both suite blocks verbatim with their real totals (core/server suite and
      UI suite; do not report only one as if it covered both — this project's standing rule).
- [x] 8.5 Deliver per `agent-conductor-worker` → `references/delivery.md`; transition the ticket to
      `in_review`. The delivery note/PR description states plainly, per design.md's Migration Plan:
      what a rollback to the immediately-prior daemon build does under this design — nothing.
      `workspace.yaml`, `daemon.yaml`, role files, and a project's stored policy all keep their
      pre-existing spelling on every write this ticket makes; no field is an exception; so captain has
      this in hand before ever needing it.

## 9. PR review fixes (conductor's review of PR #229, and a re-check of an earlier scope note)

- [x] 9.1 `writeRoleFiles` (`packages/core/src/roles/index.ts`) went through neither
      `toLegacySpelling` nor any equivalent, so `role.yaml` was the one persisted artifact Decision 6
      missed — a rolled-back pre-VS-263 daemon's `RoleSpecSchema` (still `z.enum(['human',
      'conductor'])`) fails to parse a `createdBy: weaver` file and `readRoleSpec` returns `null`,
      silently deleting the role. Added `toLegacyRoleSpec` (packages/shared) and wired it into
      `writeRoleFiles`, covering all three of its callers (hire, spec update, charter update) from one
      place. Verify: `packages/shared/src/config.test.ts`'s round-trip unit test, and
      `packages/core/src/roles/roles.test.ts`'s new service-level test asserting the on-disk bytes say
      `createdBy: conductor` and `readRoleSpec` still returns `'weaver'`.
- [x] 9.2 `packages/core/src/workspace/portable.ts`'s `exportWorkspace` fallback (no `workspace.yaml`
      on disk to copy verbatim) serialised `ctx.config` raw, producing a new-spelling file in exactly
      the artifact most likely to travel to an older daemon. Routed it through `toLegacySpelling`.
      Verify: new `portable.test.ts` case exercising the fallback path specifically (the existing tests
      all pre-seed `workspace.yaml`, so none had covered it).
- [x] 9.3 `skills/manifest.json`'s `audience: conductor | worker | all` vocabulary — flagged in scope
      by an early ticket comment, confirmed by VS-259's own design.md as deferred here, and missed by
      this ticket's own propose-phase research. Unlike the write sites above, the manifest ships
      inside the release directory itself (a rollback restores the old manifest alongside the old code
      that reads it), so this is a plain rename, not a Decision-6 legacy-write case: `audience:
      conductor` → `audience: weaver` in the manifest, `skills/README.md`'s table and prose,
      `home.test.ts`'s type and literal comparisons, and a `worker-provisioning/runtime-skill-path`
      spec delta (found this capability documents the same vocabulary; added as a Modified Capability).
      Verify: `packages/core/src/workers/home.test.ts` and `openspec validate --strict`.
