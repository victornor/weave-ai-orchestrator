## 1. Storage and shared types

- [x] 1.1 Add `packages/db/src/migrations/0043_plan_multi.sql`: drop `plans_one_drafting_per_project`, add `plans.title_source` (`'auto'|'human'`, default `'auto'`), backfill existing non-null titles to `'human'`; verify with `./node_modules/.bin/vitest run packages/db` covering the drop, the default and the backfill
- [x] 1.2 In `packages/shared`: add `PLAN_TITLE_SOURCES`/`PlanTitleSource`, `PLAN_TITLE_MAX_WORDS`, `Plan.titleSource`, a `plan.titled` event type, and `weave_plan_set_title` in `PLANNER_TOOLS`; verify `pnpm --filter @weave-ai/shared exec vitest run src/tools.test.ts` and `pnpm typecheck`

## 2. Core planning service

- [x] 2.1 In `packages/core/src/planning/index.ts`: remove the one-drafting-plan guard in `create`, make `getDrafting` return the most recent drafting plan, add `listDrafting(projectId)` returning summaries (id, title, titleSource, status, draftCount, createdAt, updatedAt) newest first, and update the `PlanningService` interface in `packages/core/src/api.ts`; verify `./node_modules/.bin/vitest run packages/core/src/planning`
- [x] 2.2 Add `setTitle(actor, planId, title, source)` that normalises the text, caps auto titles at six words, and refuses to change a plan whose `title_source` is `'human'`; emit `plan.titled`; verify in `planning.test.ts` that an auto title stores, that an auto regenerate replaces a still-auto title, and that a captain rename is never overwritten
- [x] 2.3 Replace the old "refuses a second one for the same project" test with coverage that two drafting plans coexist, that the summary list is newest-first with draft counts, and that discarding one leaves the other's drafts and status untouched; verify `./node_modules/.bin/vitest run packages/core/src/planning`

## 3. Core workers: create, resume, lifecycle

- [x] 3.1 Extract the plan+thread+planner creation out of `startOrResumePlan` into `createPlan(actor, projectId, opts?)`, keep `startOrResumePlan` resuming the most recently created drafting plan, and expose both on `WorkersService`; verify `./node_modules/.bin/vitest run packages/core/src/workers` covers "start resumes the newest" and "a second plan has its own thread and planner"
- [x] 3.2 Add `retireIdlePlanners(projectId, { keepPlanId, idleMs })` that retires only planners with no running turn and no turn within the idle window, leaving the kept plan and every plan's data intact; verify in `workers.test.ts` that an idle planner is retired and re-ensured while a running one is not

## 4. Server routes and planner tool

- [x] 4.1 Add the plan-tab routes to `packages/server/src/routes/projects.ts` — `GET /:id/plans?status=drafting`, `POST /:id/plans`, `POST /:id/plans/:planId/activate`, `PATCH /:id/plans/:planId` — reusing `scopedPlan`, and return 404 for a plan of another project; verify `./node_modules/.bin/vitest run packages/server/test/plans.test.ts`
- [x] 4.2 Register and implement `weave_plan_set_title` in `packages/server/src/tools.ts` (planner-only, plan-scoped, writes `planning.setTitle(..., 'auto')`); verify `./node_modules/.bin/vitest run packages/server/test/planTools.test.ts` plus `packages/shared/src/tools.test.ts` for the tool-registry guard
- [x] 4.3 Add the new plan routes and the planner title tool to `docs/API.md`; verify the file names every route added in 4.1

## 5. V2 Plan modal

- [x] 5.1 Add `usePlans`, `useCreatePlan`, `useActivatePlan` and `useRenamePlan` to `packages/ui/src/api/hooks.ts` with a `qk.plans(ws, projectId)` key, and invalidate the plan list on `plan.created`/`plan.titled`/`plan.discarded`/`plan.submitted`; verify with the UI hooks' existing test pattern or `pnpm --filter @weave-ai/ui exec vitest run`
- [x] 5.2 Render the tab strip in `PlanModal.tsx` (one tab per drafting plan, focused tab marked), the **New plan** control, and the empty state when a project has no drafting plan, replacing the auto-start-on-open behaviour; verify `./node_modules/.bin/vitest run packages/ui/src/test/v2planmodal.test.tsx` covers tabs rendering, New plan adding and focusing a tab, and empty state
- [x] 5.3 Add per-tab switch (loading that plan's conversation and drafts), delete with an inline confirm using the discard path, double-click rename, the "New plan" placeholder for an untitled tab, and the device-remembered last-focused tab; verify the same test file covers switching, delete-confirm, rename and the remembered tab
- [x] 5.4 Verify the planner's title reaches the tab: with a mocked plan list where one plan has an auto title, one is untitled and one is renamed, assert each tab renders its expected label; run `./node_modules/.bin/vitest run packages/ui/src/test/v2planmodal.test.tsx`

## 6. Specs

- [x] 6.1 Correct the Purpose sentence in `openspec/specs/planning-sessions/storage/spec.md` so it no longer claims a project has a single plan; verify the file reads consistently with the change's storage delta

## 7. Verification and delivery

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, pasting both suite blocks (core/server and UI) verbatim with their counts; fix anything red before proceeding
- [x] 7.2 Capture rendered evidence on a source-built scratch daemon (own `--config-dir`, loopback port other than 7433, stopped by recorded PID): the Plan modal with three tabs (one AI-titled, one "New plan", one renamed) and the delete confirm, dark and light at 1440 plus dark at 390, saved outside the worktree, with absolute paths reported
- [x] 7.3 Confirm `git status --porcelain` in the worktree is empty before requesting review, commit the implementation with VS-477 messages, and open the PR
- [x] 7.4 Add one project knowledge note only if a durable, non-obvious fact emerged (for example the title-mechanism trade-off, if not already covered by an existing document)
