## 1. Data plumbing and enums

- [x] 1.1 Add `'scout_report'` to `WAKE_SOURCES` in `packages/shared/src/enums.ts` and verify `pnpm typecheck` passes with the new source used below
- [x] 1.2 Add `PlanningService.findDraftByTicket(ticketId)` in `packages/core/src/planning/index.ts` (reverse lookup on `plan_drafts.created_ticket_id`, indexed) and cover it with a unit test: a draft linked to a ticket is found by that ticket's id, and an unlinked ticket id returns null

## 2. Dispatch action

- [x] 2.1 Add a `dispatchDraft` capability to `PlanningService`/`TicketsService` boundary (core-level, actor-agnostic) that: validates the draft is `kind: 'scout'`, its plan is `drafting`, and its `status` is still `pending`; creates a ticket via the same path `weave_ticket_create` uses, carrying the draft's title, description, priority and `targetRoleId`, with `assigneeRoleId` set so it dispatches immediately; and calls the existing `linkDraft(draftId, { ticketId })`. Cover with unit tests for: success, a non-scout draft refused, a draft in another/non-drafting plan refused, an already-dispatched draft refused
- [x] 2.2 Both paths call the same core `dispatchDraft`: (a) `POST /:id/plans/:planId/drafts/:draftId/dispatch` in `packages/server/src/routes/projects.ts` for captain, same family as submit/discard/patch/delete-draft; (b) `weave_plan_draft_dispatch` added to `PLANNER_TOOLS` in `packages/shared/src/tools.ts` and its handler in `packages/server/src/tools.ts` (`scope: 'planner'`, input `{ draftId }`, using `requireOwnDraft`) — reviewed and confirmed with the weaver: captain's original ask was to stop clicking through 15-20 pending scouts one at a time, so the planner needed the same capability, not only the modal button. An earlier pass of this task gave the HTTP route only; reverted after weaver review
- [x] 2.3 Verify end-to-end with integration tests on both paths: dispatching a scout draft (via the HTTP route, and via the planner tool) results in a real ticket with a worker assigned, the draft's `status`/`createdTicketId` reflect it, a non-scout draft is refused and stays unfiled, an already-dispatched draft can't be dispatched twice, a planner can't dispatch another plan's draft, and GET/`weave_plan_get` carry the dispatched draft's live `ticketStatus`

## 3. Report routing back to the planner

- [x] 3.1 In `packages/core/src/tickets/service.ts`'s terminal-transition path (alongside `propagateTerminal`), add a lookup via `findDraftByTicket`; when found and the draft's plan is `drafting`, schedule (not inline-await) a call that ensures the plan's planner (`workers.ensurePlanner`) and enqueues a `scout_report` wake at that planner's agent id, carrying `{ ticketId, draftId, planId }`. Verify with a unit test that a scout ticket dispatched from a plan, on reaching `done`, results in exactly one `scout_report` wake at the planner's agent id and zero wakes at the weaver's agent id
- [x] 3.2 Verify the fallback: a scout ticket linked to a draft whose plan is `submitted` or `discarded` reaches `done` and enqueues no `scout_report` wake and does not attempt to ensure a planner
- [x] 3.3 Verify re-ensure: a scout ticket's plan is `drafting` but its planner was previously retired (no live `agents` row for the plan) — completion still results in a live planner and a delivered `scout_report` wake
- [x] 3.4 Add the `scout_report` wake's prompt injection in `packages/core/src/prompts/index.ts` (mirroring the existing `plan_submitted` injection) telling the planner to call `weave_plan_get` to read the finished scout's report
- [x] 3.5 Extend `weave_plan_get`'s handler in `packages/server/src/tools.ts` so each returned draft with a `createdTicketId` carries that ticket's current status and, once terminal, its report document's body. Verify with a test: a plan with one dispatched-and-finished scout draft returns that draft's report content in the same call, without a second tool

## 4. Weaver plan-submission skip

- [x] 4.1 Update `creationOrder` (or its caller) in `packages/core/src/planning/index.ts` so it only orders drafts whose `status` is `pending`, and update the `weave_plan_get` response so a dependent draft's blocker resolution can find an already-created draft's `createdTicketId` even though it is excluded from `creationOrder` itself
- [x] 4.2 Update the `plan_submitted` wake's prompt injection in `packages/core/src/prompts/index.ts` to state explicitly that a draft already linked to a ticket (dispatched before submission) is skipped, and that a dependency on such a draft uses its existing ticket id as the blocker
- [x] 4.3 Verify with a unit test: submitting a plan with one already-dispatched scout draft and one pending draft that depends on it results in exactly one ticket created (for the pending draft), blocked by the already-existing scout ticket

## 5. Plan modal UI

- [x] 5.1 Add a `useDispatchPlanDraft` mutation hook (mirroring `useSubmitPlan`/`usePatchPlanDraft` in `packages/ui/src/api/hooks.ts`) calling the new dispatch endpoint/tool path
- [x] 5.2 In `packages/ui/src/v2/PlanModal.tsx`, add a per-draft Dispatch action visible only for a `scout` draft with `status: 'pending'` in a `drafting` plan, and a status indicator (dispatched/running, reported, failed) replacing it once `status` is `created` or `failed`, driven by the enriched draft data from task 3.5's HTTP-facing equivalent
- [x] 5.3 Verify the HTTP plan-read route the modal uses (`packages/server/src/routes/projects.ts`) enriches drafts the same way `weave_plan_get` does, so the UI does not need a second request per draft
- [x] 5.4 Verified by rendering `PlanModal` directly against real headless Chromium (mocked-fetch harness, no daemon — see project KB "Screenshotting a packages/ui route without a daemon"), not the running app end to end (no scratch daemon/worker pipeline was spun up). Screenshots in both themes and at desktop/phone width, showing a dispatchable scout, one running, one reported, and the unaffected change draft, at `/home/user/agent-conductor/workspace/workers/01M2RFPP9ZDCES1JJTKRQJKNA4/vs-517-screenshots/` (outside the worktree, per this project's untracked-worktree-files rule)

## 6. Full verification

- [x] 6.1 `pnpm lint && pnpm typecheck` pass
- [x] 6.2 `pnpm test` passes — paste both the core/server suite block and the UI suite block in the delivery report, not just one
- [x] 6.3 Confirm every acceptance criterion in the ticket is met: dispatch from an unsubmitted plan reaches the planning conversation; the weaver gets no wake from dispatch, report, or completion; change drafts stay unfiled until submission; a submitted plan never re-files a dispatched scout; the scout is a real, visible ticket while running; the plan shows each dispatched scout's state
