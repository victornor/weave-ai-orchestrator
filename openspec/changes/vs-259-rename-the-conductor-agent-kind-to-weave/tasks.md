## 1. Shared: enum, migration, decision-review fields

- [x] 1.1 Update `AGENT_KINDS` and `INCIDENT_REPORTER_KINDS` in `packages/shared/src/enums.ts` from
      `'conductor'` to `'weaver'`; verify `pnpm typecheck` fails everywhere a call site branched on
      the old literal (used in later tasks as the punch list, not fixed here).
- [x] 1.2 Write `packages/db/src/migrations/0027_agent_kind_weaver.sql` per design.md Decision 1: one
      `-- ac:foreign_keys_off` file rebuilding `agents` (CHECK + `agents_one_conductor` →
      `agents_one_weaver` index predicate), `decisions` (`owner` CHECK, and its four
      `conductor_review_*` columns renamed to `weaver_review_*` in the same rebuild), and `roles`
      (`created_by` default), each `INSERT … SELECT` transforming the renamed column with a `CASE
      WHEN … = 'conductor' THEN 'weaver' ELSE …`. In the same file, add two plain `UPDATE` statements
      (no rebuild needed — neither column has a CHECK or default naming the value):
      `UPDATE role_revisions SET author = 'weaver' WHERE author = 'conductor'` and
      `UPDATE incidents SET reporter_kind = 'weaver' WHERE reporter_kind = 'conductor'` (the latter
      is a safe no-op against an empty `incidents` table and also applies when this migration runs
      against `daemon.sqlite`). Verify `pnpm vitest run packages/db` passes, including the existing
      `migrations.test.ts` suite applied to a fresh empty schema.
- [x] 1.3 Add a migration test that seeds a database shaped like a live workspace before migrating —
      one `agents` row with `kind = 'conductor'`, one or more `decisions` rows with
      `owner = 'conductor'` (including at least one carrying non-default `conductor_review_*` values),
      one `roles` row with `created_by = 'conductor'`, one or more `role_revisions` rows with
      `author = 'conductor'`, and one `incidents` row with `reporter_kind = 'conductor'` — then
      asserts every row is intact, readable, and carries the renamed value after migration (spec
      `agent-kind-rename`, all five "survives the rebuild/migration" scenarios). Seed and run this
      test against **both** shapes the migration actually applies to: one seeded run leaving
      `incidents` empty (the expected shape of a workspace database — it holds no rows in any of this
      workspace's own databases) and a second seeded run with `incidents` rows present (the shape of
      `daemon.sqlite`, where this table's data actually lives — it currently carries 6 rows with
      `reporter_kind = 'conductor'`). Schema is identical between the two (`daemon.sqlite` and every
      workspace database run the same migration files), so this is two seedings of the same test, not
      two schemas — but a test that only ever seeds an empty `incidents` table would pass while
      leaving the table that matters unverified. In the same tests, per design.md
      Decision 6, scan every column of every table in each migrated database for the literal value
      `'conductor'` and assert zero matches — this scan, not the itemized column list, is the task's
      actual completion evidence. Verify the new test(s) pass and
      fail if any one transform (including the two plain `UPDATE`s) is reverted.
- [x] 1.4 Add a test asserting the one-weaver-per-workspace invariant: after migration, inserting a
      second `agents` row with `kind = 'weaver'` in the same workspace as an existing one is rejected
      by the database (spec `agent-kind-rename`, "second weaver-kind agent is rejected"); a second
      `kind = 'worker'` insert still succeeds. Verify both assertions pass.
- [x] 1.5 Rename `packages/shared/src/conductor-review.ts` and its test to `weaver-review.ts` /
      `weaver-review.test.ts`; rename every exported symbol and type field that says `conductorReview`
      to `weaverReview`. Update `packages/shared/src/types.ts`'s decision type to the renamed fields.
      Verify `pnpm vitest run packages/shared` passes and no import of the old filename remains
      (`rg "conductor-review" packages/shared`).
      Additionally found and fixed while sweeping `packages/shared` for task 1.1's punch list: the
      four `weaverReviewCopy` display strings ("Conductor reviewed…") now read "Weaver…";
      `DECISION_OWNERS` (`enums.ts`) — the TS enum mirroring `decisions.owner`, the DB column task
      1.2 already renamed — moved `'conductor'` → `'weaver'` (nothing named it in the ticket or
      VS-257's report; found by reading past `AGENT_KINDS` in `enums.ts`, not by grep); and
      `report.ts`'s `nextAction.owner` enum (the structured final-report schema every worker's turn
      is validated against) moved the same way, no downstream code branches on it today but leaving
      it stale would be a visible, findable inconsistency. Left two literal `'conductor'` sites in
      `packages/shared` deliberately: `APPROVAL_OWNERS` (workspace.yaml's `proposalApproval`/
      `hireApproval`/`taskApproval` policy value) is config-key surface per the VS-263 deferral.
      `RoleSpecSchema.createdBy` at `config.ts:310` is also named in that deferral, but `rowToSpec()`
      (`packages/core/src/roles/index.ts:34`) parses a DB-sourced `role.createdBy` — now `'weaver'`
      post-migration — through this exact schema, so leaving it unchanged breaks that call for every
      migrated role. Raised as `ac_ask` rather than decided unilaterally either way; see the ticket.

## 2. Core: identity read/write sites

- [x] 2.1 `packages/core/src/context.ts`: rename `WorkspacePaths.conductor` to `.weaver`, and the
      literal branch that names the old-vs-new directory (`status === 'old' ? 'conductor' :
      'weaver'` stays — that string names an on-disk directory VS-258 already resolves; only the
      *field name* holding the path moves). Update every reader of `.paths.conductor`.
- [x] 2.2 `packages/core/src/workers/index.ts`: rename `WorkersService.conductor()` /
      `ensureConductor()`'s internal literals (`kind: 'conductor'`, `SELECT … WHERE kind =
      'conductor'`, the `mkdirSync(ctx.paths.conductor, …)` call following task 2.1's rename) to
      `weaver`; keep the service's public method names unless design.md calls for renaming them (it
      does not — method names are prose-adjacent API surface, not stored identity, and are unchanged
      here per design.md's Non-Goals). Verify `pnpm vitest run packages/core/src/workers` passes.
- [x] 2.3 `packages/core/src/api.ts` (line ~16 and any other `'conductor'` literal in this file),
      `packages/core/src/roles/index.ts` (3 sites deciding `writeRevision`'s actor string — the rows
      they've already written are covered by task 1.2's `UPDATE role_revisions`, this task is only
      about what new writes produce), `packages/core/src/decisions/service.ts` (every read/write of
      the columns renamed in task 1.2, plus any `owner === 'conductor'` comparison), and
      `packages/core/src/incidents/index.ts` (the `INCIDENT_REPORTER_KINDS`-validated write path).
      Verify `pnpm vitest run packages/core` passes.
- [x] 2.4 Sweep the rest of `packages/core` with `rg "'conductor'" packages/core --type ts` and fix
      every remaining site meaning the agent kind (tests included). Verify the grep returns nothing
      meaning the agent kind and `pnpm vitest run packages/core` is green.

## 3. Server: tool exposure and API surface

- [x] 3.1 `packages/shared/src/tools.ts`: rename `CONDUCTOR_TOOLS` to `WEAVER_TOOLS` (array identifier
      only — the `ac_*` strings inside it are unchanged, per design.md Decision 4 and the ticket's
      "not in scope" list). `packages/server/src/tools.ts`: update the import and the 5+ sites
      comparing `kind === 'conductor'` (including the tool-list-by-kind switch at the site design.md
      cites). `packages/server/src/openapi.ts`: update the import and generated text.
      `packages/server/src/channels.ts`: update its `conductor_review_*`-adjacent references from
      task 1.2/1.5's rename. Also in `packages/server/src/tools.ts`: the incident-listing route's
      `z.enum(INCIDENT_REPORTER_KINDS)` filter (picks up task 1.1's enum rename automatically, but
      verify its test fixtures use `'weaver'`, not a stale `'conductor'`). Verify
      `pnpm vitest run packages/server` passes.
- [x] 3.2 Sweep the rest of `packages/server` with `rg "'conductor'" packages/server --type ts` and
      fix every remaining site meaning the agent kind. Verify the grep returns nothing meaning the
      agent kind and `pnpm vitest run packages/server` is green.

## 4. Render, UI, TUI: display and route code

- [x] 4.1 `packages/render/src/types.ts`, `entities.ts`, `decision.ts` and their tests: rename every
      `'conductor'` kind comparison and derived display string (e.g. `initials('conductor')`,
      `d.owner === 'conductor'`) to `'weaver'`; keep the human-facing label text itself a design call
      only where the spec requires it (the render layer may still display "Weaver" as the friendly
      name, matching how it already renders "Conductor" today — no behavior change beyond the label
      text following the renamed value). Verify `pnpm vitest run packages/render` passes.
- [x] 4.2 `packages/ui`: the 3+ route files VS-257 found plus `DecisionCard.tsx` (the renamed
      `weaverReview*` fields from task 1.5) and test factories/fixtures
      (`packages/ui/src/test/factories.ts` and friends). Verify
      `pnpm --filter @agent-conductor/ui exec vitest run` passes.
- [x] 4.3 `packages/tui/src/apps/Top.tsx` and `Chat.tsx`: rename the `kind === 'conductor'`
      comparisons and derived labels. Verify `pnpm vitest run packages/tui` passes.
- [x] 4.4 Sweep `packages/render`, `packages/ui`, `packages/tui` with
      `rg "'conductor'" packages/{render,ui,tui} --type ts --type tsx` and fix anything remaining
      that means the agent kind. Verify the grep returns nothing meaning the agent kind.

## 5. Skill, templates, docs: identifiers and prose

- [x] 5.1 Rename `skills/agent-conductor-conductor/` to `skills/agent-conductor-weaver/` (directory
      and every file inside referencing its own name); update its `skills/manifest.json` entry's
      `name` (leave `audience`'s vocabulary alone — that is VS-263's surface per design.md Decision
      5). Verify the daemon's skill-install path resolves the new directory
      (`pnpm vitest run packages/core/src/workers` or wherever skill installation is tested covers
      this) and no reference to the old directory name remains
      (`rg "agent-conductor-conductor"`).
- [x] 5.2 Rename `templates/conductor.AGENTS.md.tmpl` to `templates/weaver.AGENTS.md.tmpl`; update
      `packages/core/src/prompts/index.ts`'s `loadTemplate(ctx, 'conductor.AGENTS.md.tmpl', …)` call
      and its `CONDUCTOR_TMPL`/`CONDUCTOR_NOW` constant identifiers to the new name, reading each
      "conductor" mention inside the template file itself and rewording the ~16 that are prose about
      the agent kind (per VS-257's finding that roughly half of this file's mentions are identity,
      half prose — read each one rather than blind-replacing). Verify
      `pnpm vitest run packages/core/src/prompts` passes.
- [x] 5.3 `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`, `templates/charter.md.tmpl`:
      reword the mentions describing the agent kind (not the product name `agent-conductor`). Verify
      the prompt-templates tests (`pnpm vitest run packages/core/src/prompts`) still pass, per the
      project KB's landmine that these templates render empty rather than erroring on a missed field
      — assert rendered content, not the absence of the old word.
- [~] 5.4 `docs/PLAN.md` and `docs/API.md`: reword mentions of the agent kind (not the product name).
      Do not touch `openspec/specs/**` — its requirement prose is out of this change's scope per
      design.md Non-Goals. **Partial, by deliberate scope decision, not oversight**: `docs/API.md` is
      fully done (every route, field name and MCP-scoping mention matches the actual code changes).
      `docs/PLAN.md`'s identity-bearing domain-model/schema documentation (§2 concepts table, §6
      domain model — `agents.kind`, `roles.created_by`/`role_revisions.author`, `decisions.owner` and
      its `weaver_review_*` columns) is fixed, since a "naming contract" document stating the wrong
      schema values would be actively wrong. The ~250 remaining prose mentions of "the conductor"
      through PLAN.md's narrative sections (vision, principles, architecture walkthrough, filesystem
      layout, deployment topology) are untouched — the file is 1419 lines, already documents its own
      tolerance for drift ("Deviations from the plan are recorded in `docs/adr/`"), and VS-257's
      report categorized this class of prose as freely reworded on its own schedule. Left unticked
      rather than checked, since the task as written is not fully done.

## 6. Final verification

- [x] 6.1 Run `rg "'conductor'" packages/` and confirm every remaining hit (if any) means something
      other than this agent kind — the ticket's acceptance criterion 5. Fix or document any that
      remain and re-run until clean. 85 hits remain, every one reviewed individually and confirmed to
      mean something else: `APPROVAL_OWNERS`/`RoleSpecSchema.createdBy`/`models.conductor`/
      `WorkersRule`/`proposalApproval` (VS-263's deferred workspace.yaml/daemon.yaml config-key
      surface), the `conductor` CLI binary in argv arrays and CLI command-array fixtures, the
      `agentMarker`/pane-namespace `conductor:` prefix in the surfaces packages (product prefix, not
      agent-kind identity), `Actor.id: 'conductor'` labels that are never compared against (only
      `Actor.kind` is), and a handful of intentional pre-migration seed literals in
      `migrations.test.ts` that must say `'conductor'` to prove the migration transforms them.
- [x] 6.2 Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root and record both `pnpm
      test` suite blocks verbatim (core/server suite and the UI suite are separate — report both, per
      the project's own rule on this). `pnpm lint`: boundaries/console/test-fixtures all ok. `pnpm
      typecheck`: clean (`tsc -b` then the ui filter). `pnpm test` core/server suite: 165 test files
      passed | 1 skipped (166), 2415 tests passed | 1 skipped (2416) — the 1 skip pre-exists this
      ticket. `pnpm test` UI suite: 89 test files passed (89), 1484 tests passed (1484).
