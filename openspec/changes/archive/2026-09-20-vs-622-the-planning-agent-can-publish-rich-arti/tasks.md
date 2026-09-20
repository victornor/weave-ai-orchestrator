## 1. Data model and shared types

- [x] 1.1 Add `0057_plan_artifacts.sql` (`plan_artifacts`, `plan_artifact_revisions`, indexes, `card_message_id` on the artifact) shaped after `0030_weaver_artifacts.sql`; verify `pnpm test packages/db` applies it cleanly on an empty and an existing database
- [x] 1.2 Add `0058_plan_draft_summary.sql` adding a nullable `summary` column to `plan_drafts`; verify the db migration test passes and existing draft rows read back with a null summary
- [x] 1.3 Add `PlanDraft.summary: string | null`, a `PLAN_DRAFT_SUMMARY_MAX` constant, and `PlanArtifactSummary`/`PlanArtifactRevision` types in `packages/shared`; verify `pnpm typecheck` and the shared tests pass
- [x] 1.4 Add `weave_artifact_kit` and `weave_plan_artifact_put` to `PLANNER_TOOLS` and the `ToolName` union; verify `packages/shared/src/tools.test.ts` passes and lists both for the planner
- [x] 1.5 Add a pure `draftSummary(draft)` in `packages/render` (stored summary, else first sentence of the description, else empty) with unit tests; verify `pnpm vitest run packages/render` covers stored, empty, no-sentence and long-description cases

## 2. Core services

- [x] 2.1 Add `PlanArtifactsService` (`put`, `getRevision`, `list`, `revisions`, card-message bookkeeping) in `packages/core/src/artifacts/plan.ts`, emitting `plan_artifact.published`; verify its unit tests cover first publish revision 1, republish increment and earlier-revision retrieval, and listing scoped to one plan
- [x] 2.2 Add `summary` to `PlanDraftInput`/`PlanDraftPatch` and enforce `PLAN_DRAFT_SUMMARY_MAX` in `PlanningService.addDraft`/`updateDraft`; verify `planning.test.ts` covers a stored summary, clearing it, an over-cap refusal and a description that is unchanged by either
- [x] 2.3 Add a narrow `ThreadsService.setMessageParts(messageId, parts)` that refuses any part other than a plan-artifact card for a plan thread; verify `threads.test.ts` replaces a part, leaves message text and other parts intact, and rejects a non-card part
- [x] 2.4 Wire `planArtifacts` into `CoreServices` in `packages/core/src/api.ts` and `create.ts`; verify `pnpm typecheck` and a core smoke test that resolves the service from a workspace context

## 3. Server tools and routes

- [x] 3.1 Add `weave_plan_artifact_put` (`scope: 'planner'`) reusing `validateArtifactHtml` and `requireOwnPlanner`, publishing to the caller's own plan and posting/updating the conversation card; verify a server test publishes, republishes (one card, revision 2), rejects an empty/oversized/non-HTML body with a clear error, and refuses a caller targeting another plan
- [x] 3.2 Extend `weave_plan_draft_add`/`weave_plan_draft_update` with an optional `summary`; verify the tool tests store it, clear it when null/empty is sent, and surface the cap error
- [x] 3.3 Add `packages/server/src/routes/plans.ts` with list, `:key/revisions` and `:key/raw?revision=` behind `requireOperator` and `ARTIFACT_CSP`; verify route tests assert byte-identical bodies, the `text/html`/`nosniff`/CSP headers, explicit-revision serving, agent-token rejection, and `not_found` for a key under another plan
- [x] 3.4 Register the route group in `packages/server/src/app.ts` and document the plan artifact routes plus the new planner tools in `docs/API.md`; verify the route-listing test and `pnpm lint` pass

## 4. Prompts, skills and agent homes

- [x] 4.1 Add `weave-ai-artifacts` to `PLANNER_SKILLS` in `packages/core/src/workers/home.ts`; verify the workers home test shows the skill installed for a planner home
- [x] 4.2 Update `templates/planner.AGENTS.md.tmpl` and its `PLANNER_TMPL` fallback in `packages/core/src/prompts/defaults.ts` to name when an artifact helps, that it must still answer through `weave_plan_reply`, that the artifact is plan storage not a repo write, and to set a one-or-two-sentence summary on every draft; verify `prompts/render.test.ts` and the prompt fallback test cover the added text
- [x] 4.3 Extend `skills/weave-ai-artifacts/SKILL.md` with the planner publishing path; verify `packages/shared/src/tools.test.ts` still passes (no stray or unregistered tool token) and the skill installs for the planner

## 5. Web surface

- [x] 5.1 Add `planArtifactCardPartsOf` to `packages/render/src/parts.ts` and an optional `renderPlanArtifactMessage` to `ChatConversation` that renders a `type: 'card'` part as a titled card with an open action; verify the render/parts test parses the part and a UI test renders the card from a plan message
- [x] 5.2 Rework the `PlanTab` draft list to collapse each card by default (title, `draftSummary`, compact facts) with a per-card toggle, expand all / collapse all, the draft count, and the existing edit/reorder/dispatch/delete/tier controls on the collapsed card; verify UI tests for collapsed default, expand and collapse, fallback summary, count, and state kept across a plan update
- [x] 5.3 Add the plan artifact reader route and page (`/w/:ws/plans/:planId/artifacts/:key`) reusing `ArtifactViewer` over the raw route, and a hook to fetch the plan's artifacts and revisions; verify a UI test opens the card's open action and frames the sandboxed raw URL
- [x] 5.4 Register the new route in `packages/ui/src/router.tsx` (and the page export) and confirm the plan artifact URL still resolves after its plan is submitted; verify a UI test renders the reader for a submitted plan's artifact

## 6. Evidence and full verification

- [x] 6.1 Add an integration test proving the planner flow end to end: read the kit, publish an artifact, see the card in the plan conversation, survive a reload/planner re-ensure, and still create no real ticket and change no repository file; verify the test fails if the tool or the card is removed
- [x] 6.2 Capture rendered evidence in both themes at desktop and phone width — a planner reply with an artifact card and the opened artifact, and the draft list collapsed and one card expanded with at least six drafts — and attach the images to the ticket before requesting review
- [x] 6.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` with `--maxWorkers=4`, one full suite at a time, and paste both suite blocks verbatim in the ticket's delivery note
