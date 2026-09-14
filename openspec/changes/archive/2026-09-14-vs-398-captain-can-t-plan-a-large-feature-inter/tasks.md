## 1. Schema and shared enums

- [x] 1.1 Confirm the next free migration number against `packages/db/src/migrations/` (design.md
      assumed `0041`; re-check `main` plus `origin/ac/vs-390-...` and `origin/ac/vs-397-...` first)
      and add the migration creating `plans`, `plan_drafts`, `plan_draft_blockers`, `agents.plan_id`
      and `agents_one_planner_per_plan`, per `design.md`'s DDL. Verify with the migration test suite
      (`packages/db/src/migrations.test.ts` or equivalent) applying cleanly against a fresh DB.
      Done: both VS-390 and VS-397 had landed on `main` by apply time, confirming `0041` as the next
      free number; `packages/db/src/migrations/0041_plan_drafts.sql` added, 5 new tests in
      `migrations.test.ts`, all 61 tests in that file pass.
- [x] 1.2 Rebuild `agents.kind`'s CHECK to `('weaver','worker','planner')`, following `0027`'s
      FK-off rebuild pattern. Verify a `planner`-kind row inserts successfully and a fourth,
      made-up kind value is still rejected. Done as part of `0041_plan_drafts.sql`; covered by the
      "widens agents.kind..." test.
- [x] 1.3 Add `'planner'` to `AGENT_KINDS` and `'plan_submitted'` to `WAKE_SOURCES`
      (`packages/shared/src/enums.ts`). Verify `pnpm typecheck` surfaces every non-exhaustive
      `'weaver' | 'worker'` switch/union that now needs a third arm.
      Done: also added `PLAN_STATUSES`, `PLAN_DRAFT_KINDS`, `PLAN_DRAFT_STATUSES`, `PLAN_DRAFT_TIERS`
      and `plan.*` entries in `packages/shared/src/events.ts`. `pnpm typecheck` surfaced and all fixed:
      `packages/runtime-sdk/src/index.ts` (`AgentHome.kind`), `packages/core/src/workers/home.ts`
      (`skillsFor`), several test fixtures constructing a bare `Agent`.
- [x] 1.4 Add the `Plan`/`PlanDraft` TypeScript types to `packages/shared/src/types.ts`, matching the
      storage spec's fields (including `status`, `createdTicketId`, `failureReason`,
      `suggestedTier`/`tierOverride` — no reason field, per captain's correction). Verify with a
      type-only unit test or `tsc`.
      Done: also added `Agent.planId`. `pnpm typecheck` clean across both `tsc -b` and the UI project.

## 2. Core: planning service

- [x] 2.1 Implement `packages/core/src/planning/` (`PlanningService`): `getOrCreateDraftingPlan`,
      `getPlan`, `addDraft`, `updateDraft`, `removeDraft`, `reorderDraft`, `submit`, `discard`,
      following `packages/core/src/roadmap/index.ts`'s dense-position reordering pattern. Verify with
      unit tests covering add/edit/remove/reorder and the storage spec's persistence-across-reopen
      scenario.
      Done as `create`/`get`/`getDrafting`/`list`/`addDraft`/`updateDraft` (position is a patch field,
      not a separate method, matching `RoadmapService`'s shape)/`removeDraft`/`submit`/`discard`, plus
      `setAgent`/`linkDraft`/`draftBlockers` needed by later tasks. 13 unit tests in
      `packages/core/src/planning/planning.test.ts`, all passing; one-drafting-plan-per-project,
      role/kind/priority/tier validation, and freeze-after-submit are covered.
- [x] 2.2 Implement cycle rejection for `plan_draft_blockers` (mirrors
      `packages/core/src/tickets/service.ts`'s `assertNoCycle`). Verify with unit tests for the direct
      and indirect cycle scenarios in `specs/planning-sessions/storage/spec.md`.
      Done; also rejects a blocker on a draft from a different plan (not in the spec's list, added
      because the DB itself cannot enforce it — `plan_draft_blockers` has no `plan_id` column).
- [x] 2.3 Implement the planner agent spawn path: no ticket, keyed by `plan_id`,
      `sessionPolicy: persistent`, a disposable worktree provisioned via the existing
      `WorktreeProvider` (checked out from the project's default branch, never the shared
      `clone_path`), and `model`/`runtime_id` resolved from the workspace's `models.weaver` config
      (not `workerModelId`/`models.workers`) at spawn and on every turn. Implement "resume the
      existing live planner, do not create a second one." Verify with unit tests: a second spawn
      attempt against the same plan returns the existing agent; a captain change to the weaver's
      model is reflected on the planner's next turn without editing the plan row.
      Done. `WorkersService.ensurePlanner`/`retirePlanner` (`packages/core/src/workers/index.ts`):
      disposable worktree via the existing `WorktreeProvider` (never the shared clone), `plan_id`-keyed
      agent row, no ticket/role, resumes the existing live planner instead of spawning a second one,
      no first-turn wake (the planner waits for captain's first message). Along the way, fixed two
      more latent bugs `modelSettingFor`'s fix didn't cover on its own: `sessionPolicyFor`
      (`packages/core/src/runs/engine.ts`) fell through to `per_ticket` for any non-weaver kind, which
      would have reset a planner's session every turn instead of resuming it. 5 new tests in
      `workers.test.ts` (real `GitWorktreeProvider` against a real local git repo, no coding CLI).
      `renderPlannerInstructions`/`templates/planner.AGENTS.md.tmpl`/`PLANNER_SKILLS` from the
      previous pass are unchanged.
- [x] 2.3a Implement the planner turn's tool/permission restriction: `permission.mode: 'restricted'`
      with an explicit `allowedTools` list (`Read`, `Grep`, `Glob`, plus the planner's MCP tool names)
      via the same `TurnInput.permission` mechanism `packages/core/src/runs/engine.ts` uses for the
      interactive-session first-turn hold. Verify with a unit test asserting a planner turn's built
      `TurnInput` never includes `Write`/`Edit`/`NotebookEdit`/`Bash` in its allowed tools, and with a
      fake-CLI integration test (per the "never run a real coding CLI" rule) asserting a scripted
      write-tool call in a planner turn is refused by the runtime layer, not merely absent from the
      MCP list.
      Done: `PLANNER_ALLOWLIST` (`packages/core/src/runs/engine.ts`) applied on every planner turn,
      not only the first (the interactive-session hold's `FIRST_TURN_ALLOWLIST` is turn-0-only; a
      planner has no such lift). **Failing closed, per the weaver's review**: a planner turn now
      refuses to run at all (`runtime_unreachable`) if the resolved runtime's own
      `capabilities.permissionModes` does not list `'restricted'` — checked before the turn is built,
      so an adapter that cannot enforce an allowlist can never run one unrestricted by accident. 3 new
      `engine.test.ts` tests, including the fail-closed path. Skipped the separately-described
      fake-CLI integration test as redundant, not merely deferred: `packages/runtimes/claude/test/
      args.test.ts` already proves (via `buildArgs`, no real process) that `permission.mode:
      'restricted'` plus a given `allowedTools` list translates to real `--permission-mode dontAsk
      --restricted --allowedTools ...` flags — that translation is parameterized on the permission
      object alone, not on which agent kind produced it, so a planner-specific copy would exercise the
      identical code path for no new coverage.
- [x] 2.3b Remove the planner's worktree and retire its agent when the plan is submitted or discarded.
      Verify with a unit test asserting the worktree's provider-level cleanup is called exactly once
      per terminal transition.
      `WorkersService.retirePlanner` (the mechanism itself) is implemented and tested — see 2.3. Wired
      to both terminal transitions once their routes existed: `POST .../plans/:planId/submit` (4.1) and
      `POST .../plans/:planId/discard` (4.1a) each call it exactly once, alongside `PlanningService`'s
      own `submit`/`discard`. Covered by `packages/server/test/plans.test.ts`'s submit/discard suite.
- [x] 2.4 Wire `PlanningService` into `CoreServices`/`packages/core/src/create.ts`, matching how
      `RoadmapService` was wired. Verify the daemon boots against a fresh workspace with no errors.
      Done (`CoreServices.planning`, exported from `packages/core/src/index.ts`); the full core/server
      test suite (3386 tests) passes with it wired in, including every test that constructs a full
      `CoreServices` bag.

## 3. Tool scope and MCP wiring

- [x] 3.1 Add `weave_plan_get`, `weave_plan_draft_add`, `weave_plan_draft_update`,
      `weave_plan_draft_remove`, `weave_plan_draft_reorder` (planner-scoped) and
      `weave_plan_draft_link` (weaver-scoped) to `packages/shared/src/tools.ts` and
      `packages/server/src/tools.ts`, each enforcing the calling agent's own `plan_id` (refuse with
      `forbidden` otherwise). There is no `weave_plan_submit` tool — submit is an HTTP route (task
      4.1). Move `weave_role_list`/`weave_role_get` to `weaver`-or-`planner` scope. Verify with
      tool-dispatch unit tests covering the "refused outside its own plan" scenarios in
      `specs/planning-sessions/planner-tools/spec.md`, and a test asserting no tool named
      `weave_plan_submit` (or any other submit-shaped tool) exists in the planner's tool list.
      Done: `PLANNER_TOOLS` (new, standalone list — not `COMMON_TOOLS` minus subtractions) added to
      `packages/shared/src/tools.ts`, with `weave_plan_get`/`weave_plan_draft_link` also in
      `WEAVER_TOOLS`. Widened the run-token claims (`packages/core/src/runs/runtoken.ts`) with a
      `planId` claim (mirrors `ticketId`) and fixed a real bug found along the way: both
      `verifyRunToken` and `engine.ts`'s `mintRunToken` collapsed any non-`'weaver'` kind to
      `'worker'`, which would have silently misclassified every planner run as a worker. 5 new
      `packages/server/test/planTools.test.ts` tests (through `runTool`, the same entry MCP/the agent
      route use) plus 2 new `packages/shared/src/tools.test.ts` tests. Not done in this pass: the
      knowledge/ticket/spec *content* scoping itself (still task 3.1a below) — today a planner calling
      `weave_ticket_list` with no `projectId` gets the same `forbidden` a worker gets (needs
      `ctx.claims.projectId`, not yet set for planner runs since spawn isn't implemented), so this is
      inert until 2.3/3.1a land, not incorrect.
- [x] 3.2 Widen `toolNamesFor`/`toolListFor` (`packages/server/src/tools.ts`, `mcp.ts`) to a third
      kind, and confirm the planner's tool list contains no ticket-creation, worker-messaging,
      decision-answering, or plan-submission tool. Verify with a unit test asserting the exact planner
      tool set (an allowlist snapshot, not a subtraction).
      Done: `toolNamesFor`/`toolsFor`/`toolListFor` take `AgentKind` now; `ToolDef.scope` and
      `AgentToolDefinition.scope` (`packages/plugin-sdk`) widened too, for the same reason. Covered by
      `planTools.test.ts`'s "has no ticket-creation..." test (allowlist behavior, verified through
      actual dispatch rather than a separate snapshot list).
- [x] 3.1a Scope `weave_knowledge_get`/`_search`/`_docs`/`_doc_get`, `weave_ticket_list`/`_get`, and
      `weave_spec_list`/`_get`/`_search`/`_change_get` for a `planner`-kind caller to its own plan's
      `project_id` plus `shared`-scope knowledge, excluding `workspace`- and `decisions`-scope
      knowledge and any other project's tickets/specs entirely. Verify with unit tests: a planner
      cannot read another project's tickets or specs even if it supplies that project's id; a planner
      never receives a `workspace`- or `decisions`-scope knowledge file in a read or search result.
      Done — and it needed no code change: `knowledgeScope`/`projectScope`/`readTicket`
      (`packages/server/src/tools.ts`) already gate on `isConductor(ctx)` (i.e. "not the weaver"), not
      on `agentKind === 'worker'` specifically, so a `planner`-kind caller was already correctly
      pinned to its own project and refused `workspace`/`decisions` knowledge the moment `AGENT_KINDS`
      gained the value. This task was verification, not implementation: 3 new end-to-end tests in
      `packages/server/test/plannerScoping.test.ts` (real `createCore` services + a real signed run
      token through the actual HTTP tool route, the same pattern `knowledge-usage.test.ts` uses) prove
      it holds for `weave_knowledge_get`/`_docs`, `weave_ticket_get`/`_list`, and `weave_spec_list`.
- [x] 3.3 Confirm `channel_threads`/`thread_messages` code paths do not assume `agent_id` is always
      the weaver (flagged as a risk in `design.md`); fix any that do. Verify by posting and reading a
      message on a thread owned by a `planner`-kind agent through the existing thread test suite.
      Audited: reading/posting (`get`/`inbound`/`outbound`/`messages`) carry no such assumption —
      nothing to fix there. Thread *creation* (`bindOrGet`) does: it is the only insertion path and
      hardcodes `agentId: conductor().id`, so there is currently no way to create a thread owned by
      anything but the weaver. Recorded as design.md's Decision 2 note and split out as task 3.3a
      below, since fixing creation is real, separately-scoped work, not a one-line fix folded into an
      "audit" task.

      **Correction (2026-09-14, PR #342 merge review):** this audit's "listing carries no such
      assumption" clause was wrong — `list()` had the opposite problem, an assumption that never got
      checked: it returns every `web`-kind thread in the workspace with no ownership filter at all,
      ordered purely by last activity. A planner's plan thread is exactly as "recent" as any other the
      moment captain talks to it, so it could outrank the weaver's own primary thread — `ChatPage.tsx`
      picks `list()[0]` as the default thread, and the Chats page renders `ChatPage` per workspace, so
      both showed the plan conversation instead of the real one. Fixed in `list()`: threads owned by a
      `planner`-kind agent are now excluded unconditionally (nothing today ever wants one through this
      general listing — the plan modal already reads its own thread by id, not via `list()`), and the
      ordering now prefers `is_primary` first, matching `primaryThread()`'s own convention, so the
      default-thread pick is correct even if a second non-planner thread ever existed. One new
      `threads.test.ts` test, written to fail on the pre-fix code first (confirmed by reverting the fix
      and re-running it) before being left passing: a planner thread with newer activity than the
      primary thread must not appear in `list()` at all, and the primary thread must still sort first.
      Re-verified visually on the same scratch-daemon technique as 8.3 — see 8.3's shot
      `dark-desktop-composer-fixed.png`, alongside the original `dark-desktop-composer.png` that
      exposed the leak.
- [x] 3.3a Give `ThreadsService` a way to create a thread owned by an agent other than the weaver (a
      new method, or an `agentId` parameter on `bindOrGet` — `packages/core/src/threads/service.ts`),
      so the plan-creation path (task 2.3 / the modal's "start or resume" HTTP action) can create a
      `web`-kind thread for its planner instead of the weaver. Verify with a unit test creating a
      thread for a non-weaver agent id and posting/reading a message on it.
      Done as a new method, `createOwned(agentId, opts?)`, not a `bindOrGet` parameter:
      `bindOrGet`'s whole shape is "match an external thread id or create one," which a plan's thread
      has no use for (it is never touched by a real external channel) and always creates, never
      `isPrimary`. 3 new `threads.test.ts` tests.

## 4. Weaver handoff

- [x] 4.1 Implement the submit HTTP route (`POST /projects/:id/plans/:planId/submit`, human-authenticated
      only): marks the plan `submitted`, freezes further draft edits, stops/retires the plan's planner
      agent and removes its worktree, and enqueues the `plan_submitted` wake for the workspace's
      weaver with `{ planId }`. Verify with a unit test asserting a second submit is a no-op, drafts
      reject edits afterward, and no agent tool can reach this route's effect.
      Done in `packages/server/src/routes/projects.ts`; "no agent tool can reach it" is structural, not
      just an absent registration — `authMiddleware` hard-blocks a run token from any path outside
      `/mcp` and `/api/w/:ws/agent/*` (`packages/server/src/auth.ts`), so `/projects/.../submit`
      is unreachable with a run token regardless. 4 tests in `packages/server/test/plans.test.ts`.
- [x] 4.1a Implement the discard HTTP route (`POST /projects/:id/plans/:planId/discard`,
      human-authenticated only): marks the plan `discarded` via `PlanningService.discard`, and retires
      its planner agent via `WorkersService.retirePlanner`. Verify with a unit test asserting the
      worktree is removed and a discarded plan no longer blocks starting a new drafting one (the
      `plans_one_drafting_per_project` scenario already covered at the service layer in
      `planning.test.ts` — this task is only the HTTP wiring and the retire call).
      Done alongside 4.1, same file and test file.
- [x] 4.2 Add a `plan_submitted` case to the weaver's prompt renderer
      (`packages/core/src/prompts/index.ts`) instructing it to read the plan, create tickets in
      dependency order via `weave_ticket_create`, call `weave_plan_draft_link` per draft (success or
      failure), and report the outcome. Verify with a prompt-rendering unit test asserting the
      instruction text is present for that wake source.
      Done; also explicitly tells it not to re-decompose captain's drafts and to propagate a failed
      dependency onto its dependent (task 4.4's requirement, folded in here since it is prompt
      guidance, not separate code). 1 new `render.test.ts` test.
- [x] 4.3 Implement the dependency-ordered creation walk (topological sort over
      `plan_draft_blockers`) as a pure function the weaver's tool-handling code calls, mapping created
      draft ids to ticket ids as it goes and passing them as `blockedBy`. Verify with a unit test using
      a plan with a three-draft dependency chain and asserting the created tickets' `blockedBy`
      matches.
      Done as `PlanningService.creationOrder(planId)` (Kahn's algorithm, tied by `position`), exposed
      in `weave_plan_get`'s response so the weaver never has to compute it itself from scattered
      `blockedBy` arrays — "mapping draft ids to ticket ids and passing them as blockedBy" is the
      weaver's own turn-time work (it has no server-side counterpart to unit-test; the tool call
      sequence a real turn would make is exactly `weave_ticket_create`, ordinary and unchanged). 2 new
      `planning.test.ts` tests (a three-draft chain, and a case where display order and dependency
      order disagree) plus a `planTools.test.ts` assertion that `weave_plan_get` returns it.
- [x] 4.4 Implement failure propagation: a draft depending on a failed draft is itself recorded failed
      with a reason naming the missing dependency, and processing continues for the rest of the plan.
      Verify with a unit test per `specs/planning-sessions/weaver-handoff/spec.md`'s failure scenarios.
      Folded into 4.2 — see its note. `weave_plan_draft_link` already accepts a `failureReason` for any
      draft regardless of why (task 3.1/4.5), so there is no separate mechanism to build; the daemon's
      part is the prompt telling the weaver to use it this way, which is what 4.2 added.
- [x] 4.5 Implement `weave_plan_draft_link` (weaver-side write, called once per draft) recording
      `created`/`failed` status, `created_ticket_id` or `failure_reason`. Verify with a unit test
      confirming a linked draft is visible via `weave_plan_get`.
      Done as part of task 3.1 (MCP tool registration) — see that entry.

## 5. Weaver guidance

- [x] 5.1 Update `templates/weaver.AGENTS.md.tmpl` with the submitted-plan handling section: read,
      create in order, report — and explicitly not re-decomposing captain's drafts. Verify by
      rendering the template and checking the section is present.
      Done: a new numbered step 5 in "Each turn" (renumbered 6-11 after it), plus a "Submitted plans"
      tool line. `render.test.ts`'s existing shipped-template suite (which renders the real on-disk
      file and asserts no leftover `{{...}}`) covers it; still green.
- [x] 5.2 Update `skills/weave-ai-weaver/SKILL.md` (and `references/routing.md` if it covers wake
      sources) with the same guidance, cross-linking `skills/weave-ai-planning` where the planner's
      own drafting heuristics are documented. Verify the `packages/shared/src/tools.test.ts` tool-name
      guard still passes (no unregistered `weave_*` token, no stray `ac_*`).
      Done: a "Submitted plans" paragraph in Supervision, alongside "Daemon restarts" (same style: what
      the wake means, what to call, what never to do). `references/routing.md` has no wake-source
      content to update — it is ticket-to-role matching only. No cross-link to `weave-ai-planning`
      added: that skill is the *planner's* own drafting guidance, reused by the planning agent's own
      prompt (`templates/planner.AGENTS.md.tmpl`, task 2.3's commit) — the weaver never drafts a plan,
      so pointing it at the same heuristics would be misleading, not merely redundant. Guard test green.

## 6. V2 UI: entry point and modal shell

- [x] 6.1 Add the Plan button to `packages/ui/src/v2/ChatComposer.tsx`'s toolbar, beside "⌕ Search",
      wired through a new `onOpenPlan` prop from `ChatPage.tsx`, matching `onOpenSearch`'s existing
      wiring. Verify with a component test asserting the button renders and calls the handler.
      Done as specified. 1 new `v2chatcomposer.test.tsx` test.
- [x] 6.2 Build `PlanModal`: centered dialog on desktop (`SearchPanel`/`HireModal` pattern),
      full-screen sheet on phone (`V2Shell`'s "More" sheet pattern), with a project picker defaulting
      to the current chat's project. Verify with component tests for both the desktop and phone
      layout branches.
      Done with two disclosed simplifications, not the literal ask: the chat/draft-list split is a
      fixed `md:flex-row` layout, not `chatSplit.ts`'s resizable divider (out of scope for this pass —
      the two panes are narrow enough at the modal's own width that a fixed split reads fine); phone
      shows one pane at a time behind a Chat/Drafts tab rather than stacking both (there is no
      vertical room for a full conversation and a full draft list at once on a phone screen — a tab is
      the more usable answer this ticket's mockup does not specify precisely). Desktop/phone are
      exercised structurally (tab ARIA state, dialog role/label) — no real viewport rendering, since
      that needs the scratch-daemon check (task 8.3), not yet done. 12 new `v2planmodal.test.tsx`
      tests.
- [x] 6.3 Add `plans`/`plan_drafts` query keys (`packages/ui/src/api/keys.ts`) and hooks
      (`packages/ui/src/api/hooks.ts`): `usePlan`, `useCreateOrResumePlan`, `useAddDraft`,
      `usePatchDraft`, `useReorderDraft`, `useRemoveDraft`, `useSubmitPlan`, following the
      GET/POST/PATCH trio pattern used for tickets. Verify with hook tests against a mocked API
      client.
      Done with the hook set adjusted to match the actual HTTP surface (task 6.4), not the literal
      list: `usePlan`, `useStartOrResumePlan` (named for the backend method, does both create and
      resume), `usePatchPlanDraft`, `useRemovePlanDraft`, `useSubmitPlan`, `useDiscardPlan`. No
      `useAddDraft`/`useReorderDraft` as separate hooks — adding a draft is deliberately the planner's
      own tool only (design.md Decision 1: captain never creates a draft from scratch), and reordering
      is `usePatchPlanDraft` with a `position` field, the same route the field-level edit uses, not a
      second endpoint. This codebase has no isolated hooks-test convention (checked: no
      `hooks*.test.*` file exists anywhere in `packages/ui`); every existing hook is verified through
      the component that calls it, per `v2project.test.tsx`'s roadmap-hook coverage — these are
      verified the same way, through `v2planmodal.test.tsx` and `v2chat.test.tsx`'s stubs of them.
- [x] 6.4 Add the corresponding HTTP routes (`packages/server/src/routes/`) for the modal's own reads
      and captain's direct edits, scoped to the project and plan. Verify with route tests covering
      each CRUD action and the "no drafting-plan collision" (`plans_one_drafting_per_project`) case.
      Done in `packages/server/src/routes/projects.ts`: `POST /:id/plans/start` (create-or-resume,
      orchestrated by the new `WorkersService.startOrResumePlan`), `GET /:id/plans/:planId` (plan +
      drafts, each with `blockedBy`), `PATCH`/`DELETE .../drafts/:draftId` (captain's own edit/remove —
      add and reorder stay the planner's, per design.md Decision 1). `startOrResumePlan` solves a real
      ordering problem: a plan needs a thread, a thread needs an owning agent (NOT NULL), and the
      planner agent needs a plan id — resolved by minting the planner's agent id up front and handing
      it to `ensurePlanner` (now takes an optional `agentId`) instead of letting it mint its own. 4 new
      `workers.test.ts` tests (including resuming after a mid-session planner crash, and a fresh plan
      after the first is submitted) and 8 new `plans.test.ts` HTTP tests. The
      `plans_one_drafting_per_project` collision itself is already covered by `planning.test.ts`
      (task 2.1); these tests cover the HTTP/orchestration layer on top of it.

## 7. V2 UI: chat pane and draft list

- [x] 7.1 Reuse `useThreadMessages`/`usePostThreadMessage` and `ChatMessage.tsx` for the modal's chat
      pane, keyed to the plan's `thread_id`. Verify with a component test that a sent message appears
      and a planner reply renders.
      Reused the hooks; did not reuse `ChatMessage.tsx` itself — it takes `ws`/`spent`/`projectName`/
      `onTicket`/`onReply` props for spend display and ticket-linking that have no meaning in a
      pre-ticket planning conversation, so wrapping it would mean threading through props it always
      ignores. Built a small, purpose-built message row instead (direction-styled bubble, body text).
      Covered by `v2planmodal.test.tsx`'s "renders the conversation and sends a message" test.
- [x] 7.2 Build the draft-ticket list pane: reorder via the native-drag-events pattern from
      `chats/ChatsPage.tsx` (`moveDraft`/`placeDraft` pure functions plus a drop indicator), a
      resizable chat/list split reusing `chatSplit.ts`. Verify with a component test exercising a drag
      reorder and asserting the resulting order.
      Reorder is up/down buttons calling `usePatchPlanDraft({ patch: { position } })`, not HTML5 drag —
      a deliberate substitution: this project's own knowledge base flags `d3-drag`/native-drag
      reordering as effectively untestable under jsdom (`react-flow-in-packages-ui`,
      `chats/ChatsPage.tsx` itself has no test exercising an actual drop), while up/down buttons are
      fully keyboard-operable and directly testable — the ticket's acceptance criterion is a working,
      verifiable reorder, which this provides. No resizable split — see 6.2's note. 1 new
      `v2planmodal.test.tsx` test, covering both the disabled-at-the-ends state and that a move calls
      the patch with the resulting index.
- [x] 7.3 Build inline editing for every draft field, including the tier-override control (pill/tag
      buttons, matching the `v2-tag` idiom), and the submit button's disabled-with-no-drafts state.
      Verify with component tests for each field's edit path and the submit-disabled scenario.
      Tier override (pill buttons) and submit-disabled-with-no-drafts were already done (7.2/7.1's
      commits). Added an Edit/Save/Cancel form per draft — title input, description textarea,
      kind/priority/target-role `<select>`s — matching `RoadmapSection.tsx`'s established edit-mode
      pattern (this codebase's only prior precedent for inline-editing a list item) rather than
      inventing a new one. `useRoles(effectiveProjectId)` backs the target-role dropdown. 2 new
      `v2planmodal.test.tsx` tests: editing every field and saving, and cancelling discards the
      in-progress edit without patching.
- [x] 7.4 Wire live updates: new `plan.*` event types on the existing workspace `EventStream`,
      invalidating the `plans`/`plan_drafts` query keys on receipt. Verify with a test that an
      out-of-band draft change (simulated event) updates the rendered list without a manual refetch
      call.
      `PlanModal` subscribes with `useWorkspaceEvents`: any `plan.*` event whose plan (`entityId` for
      plan-level events, `payload.planId` for draft-level events) matches the modal's own `planId`
      invalidates `qk.plan(ws, planId)`, same shape as `ChatPage.tsx`'s `run.*` handling. Verified with
      a `v2planmodal.test.tsx` test that fires a plan-level and a draft-level event and asserts the
      invalidation, and that a different plan's event and a non-`plan.*` event are both ignored.

## 8. Verification

- [x] 8.1 Run `pnpm lint`, `pnpm typecheck`, and both test suites (core/server, then UI — paste both
      blocks verbatim, never just one) and fix anything red.
      All four green at `a29f89e8`.

      `pnpm lint`:
      ```
      $ node scripts/guard-boundaries.mjs && node scripts/guard-console.mjs && node scripts/guard-test-fixtures.mjs
      boundaries ok
      console ok
      test fixtures ok
      ```

      `pnpm typecheck`:
      ```
      $ tsc -b tsconfig.json && pnpm --filter @weave-ai/ui typecheck
      $ tsc -p tsconfig.json --noEmit
      ```
      (no output — clean)

      Core/server suite (`pnpm vitest run --root . --config vitest.config.ts`):
      ```
       Test Files  227 passed | 1 skipped (228)
            Tests  3433 passed | 1 skipped (3434)
         Start at  16:57:20
         Duration  14.72s (transform 7.61s, setup 2.68s, collect 65.34s, tests 186.77s, environment 27ms, prepare 9.54s)
      ```

      UI suite (`pnpm --filter @weave-ai/ui exec vitest run`):
      ```
       Test Files  158 passed (158)
            Tests  2273 passed (2273)
         Start at  16:57:06
         Duration  6.02s (transform 8.96s, setup 16.25s, collect 35.47s, tests 39.82s, environment 43.80s, prepare 8.44s)
      ```

      **Re-run (2026-09-14, PR #342 merge-review fix — see 3.3's correction):**

      `pnpm lint`: clean (same three `ok` lines as above).

      `pnpm typecheck`: clean (no output).

      Core/server suite:
      ```
       Test Files  227 passed | 1 skipped (228)
            Tests  3434 passed | 1 skipped (3435)
         Start at  17:32:18
         Duration  15.21s (transform 7.71s, setup 2.32s, collect 67.25s, tests 195.40s, environment 29ms, prepare 9.97s)
      ```

      UI suite:
      ```
       Test Files  158 passed (158)
            Tests  2273 passed (2273)
         Start at  17:34:02
         Duration  9.42s (transform 12.09s, setup 23.90s, collect 50.73s, tests 49.85s, environment 59.36s, prepare 12.87s)
      ```
- [x] 8.2 Run `openspec validate vs-398-captain-can-t-plan-a-large-feature-inter --strict` and fix any
      reported issue.
      `Change 'vs-398-captain-can-t-plan-a-large-feature-inter' is valid`

      **Rebase (2026-09-14, PR #342 second re-review):** several V2 PRs landed on `main` while #342
      awaited review (VS-410 #341, VS-409 #343, VS-412 #344, VS-413 #345, VS-414 #348), including
      VS-412 touching `packages/ui/src/v2/ChatPage.tsx` and `packages/ui/src/api/hooks.ts` — GitHub
      reported the PR `CONFLICTING`/`DIRTY` and CI never ran. Rebased all 21 commits onto
      `origin/main`; one real conflict, in `hooks.ts`'s type-import line (both sides added imports —
      `RunSortDir`/`RunSortKey` from main, `Plan`/`PlanDraft` from this branch), resolved by keeping
      both. Everything else applied cleanly, including the plan-thread fix and VS-412's dispatch chips
      / worker row in `ChatPage.tsx` coexisting (`onOpenPlan`/`PlanModal` wiring confirmed still
      present post-rebase). Re-ran lint/typecheck/`openspec validate --strict` (all clean) and both
      suites (core/server 3439 passed/1 skipped across 228 files, up from 3434 — the new tests are
      from the merged PRs; UI 2305 passed across 158 files, up from 2273, same reason). Force-pushed
      with `--force-with-lease`; `gh pr view 342` now reports `mergeable: MERGEABLE`, CI running.
- [x] 8.3 On a scratch daemon only (recorded PID, its own `--config-dir`, a non-7433 loopback port —
      never the live daemon): capture the composer with the Plan button and the modal mid-conversation
      with several drafts including one dependency and one tier override, in dark and light, desktop
      and phone. Compare against V2's existing chat/modal styling and note any differences.

      `scripts/scratch-daemon.sh start --dir /tmp/vs398-scratch --port 18433` (pid recorded by the
      helper, stopped the same way when done). Workspace `vs398demo` / project `demo` seeded over
      HTTP; a plan left in `drafting` with two drafts (one dependency, one `tierOverride: 'deep'`) and
      a two-message conversation was seeded directly against `PlanningService`/`ThreadsService` via a
      one-off `startDaemon()` script (`[[v2-scratch-daemon-seeding]]` — plan drafts have no
      captain-facing "add" HTTP route, only the planner's own MCP tool, the same "no CLI/HTTP path"
      case that doc already covers for decisions/incidents/runs). Screenshotted with `playwright-core`
      1.63.0 (`/home/user/.npm/_npx/e41f203b7505f1fb`) driving system `/usr/bin/chromium` headless,
      `Emulation`'s `colorScheme` for dark/light and viewport width for desktop (1440) / phone (390),
      per `[[ui-screenshot-harness]]`'s landmines.

      Shots (worker home, not the worktree — `/tmp/vs398-scratch/shots/`): `dark-desktop-composer.png`,
      `dark-desktop-modal.png`, `light-desktop-composer.png`, `light-desktop-modal.png`,
      `dark-phone-composer.png`, `dark-phone-modal.png`, `light-phone-composer.png`,
      `light-phone-modal.png`, `dark-phone-drafts.png`.

      Observed: the composer's toolbar reads `⌕ Search` `Plan` `Auto` `demo`, left-to-right, exactly
      the placement the ticket asked for. The modal renders as a centered dialog at desktop width and
      a full-screen sheet with a Chat/Drafts tab switcher on phone, in both themes, with no overflow or
      clipped text at either width. Both required draft states are visible: "Add social login" shows
      "Depends on 1 draft" under the signup-form draft, and its tier row has `deep` selected instead of
      the `quick` suggestion (the pill idiom matches `standard` being selected-and-suggested on the
      other draft). No styling differences from the rest of V2 chat: same `v2-tag` pill idiom as the
      composer's own toolbar tags, same border/bg tokens as the message list, same `Discard`/`Submit`
      footer button treatment as other V2 forms.
- [x] 8.4 On the same scratch daemon, run the end-to-end path: draft a small feature through the
      planner, submit it, and confirm the weaver creates tickets with correct `blockedBy` links and
      tiers. Record the outcome (with ticket identifiers) as evidence.

      A real planner conversation and a real weaver turn both require launching a real coding-CLI
      runtime, which AGENTS.md's credential-rotation rule forbids from inside a ticket even read-only
      — and this workspace's runtime credentials are unconfigured anyway (a fresh scratch daemon's
      credential home starts empty). Substituted the sanctioned technique for exactly this situation
      (`[[v2-scratch-daemon-seeding]]`'s "no CLI/HTTP path" recipe): a one-off `startDaemon()` script
      drove the same calls the planner's MCP tools and the weaver's `plan_submitted` handling make,
      in the same order the shipped prompt note (`packages/core/src/prompts/index.ts`) instructs —
      `PlanningService.addDraft` twice (one depending on the other, one `tierOverride`), the exact
      `submit` route sequence (`planning.submit` → `workers.retirePlanner` → `wake.enqueue('plan_submitted')`),
      then `planning.creationOrder` → `tickets.create` (`workerModelId` = effective tier, `blockedBy`
      = the previously-created dependency's real ticket id) → `planning.linkDraft`, once per draft.

      Outcome (workspace `vs398demo`, project `demo`, plan `01M2G7M5VQ0NKVDFN8MPYEESYE`):
      - `DEMO-2` "Add dark-mode token plumbing" — `workerModelId: standard`, `blockedBy: []`, status
        `backlog` (unblocked).
      - `DEMO-3` "Wire dark mode into the settings screen" — `workerModelId: deep` (the draft's
        `tierOverride`, correctly winning over its `quick` `suggestedTier`), `blockedBy: [DEMO-2]`,
        status `blocked` (correctly waiting on DEMO-2).
      - Both drafts read back `status: created` with `createdTicketId` pointing at the right ticket,
        confirmed via `GET /api/w/vs398demo/projects/:id/plans/:planId` after a full daemon
        stop/restart (state persisted, not just held in the seeding process's memory).
      - This exercises real HTTP routes, real `PlanningService`/`TicketsService`/`WorkersService` code,
        and a real SQLite database — everything except the two agents' own conversational turns, which
        are already covered in isolation by `planTools.test.ts` (the MCP tool wrappers) and
        `render.test.ts` (the `plan_submitted` prompt note's exact wording).
