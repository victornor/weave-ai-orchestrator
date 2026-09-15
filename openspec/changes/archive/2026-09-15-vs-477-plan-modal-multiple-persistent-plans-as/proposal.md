## Why

Captain likes that the Plan modal's planning session survives a refresh, but there is exactly one
session per project and no way to leave it: the daemon enforces one `drafting` plan per project
(`plans_one_drafting_per_project`), reopening the modal always resumes it, and a plan can only leave
`drafting` by being submitted. Captain asked for several persistent plans open as tabs, a control to
start a fresh plan, a way to delete a plan without executing it, and an AI-generated title on each
plan's tab.

## What Changes

- **Several drafting plans per project.** Drop `plans_one_drafting_per_project` (new migration);
  creating a plan no longer refuses while another is drafting, and `POST /plans/start` keeps
  working by resuming the most recent drafting plan or creating one.
- **Plan-tab API.** Add `GET /projects/:id/plans?status=drafting` (id, title, status, draft count,
  created/updated, newest first), `POST /projects/:id/plans` (create a drafting plan with its own
  thread and planner, independent of any other), and `PATCH /projects/:id/plans/:planId` (rename).
- **`plans.title_source`** (`auto` | `human`), so an AI title never overwrites a title captain
  renamed, while a still-auto title may be regenerated when the plan's scope clearly changed.
- **AI-generated tab titles.** The planner names its own plan with a new `weave_plan_set_title`
  tool, on its first turn (which follows the first human message, and always coincides with the
  first draft), naming it in ≤ 6 words. Until then the tab reads **New plan**.
- **Tabs in the Plan modal**, one per drafting plan for the project, persisted server-side so they
  survive a refresh and a different device. A **New plan** control creates a fresh plan and focuses
  its tab; switching tabs switches the conversation, draft list and planner; the last-focused tab is
  remembered locally; submitting a plan closes its tab and leaves the others.
- **Delete a plan without executing it.** Each tab has a delete (×) with a confirm; it uses the
  existing discard path (status `discarded`, planner retired, no tickets created) and keeps the plan
  and its thread as history. Deleting the last tab leaves an empty state with **New plan**.
- **Planner lifecycle for several tabs.** Only the focused plan's planner is ensured live; a planner
  that has been idle beyond a threshold is retired (its disposable worktree removed) and re-ensured
  when its tab is opened again, with the conversation and drafts always read from storage. Idle
  planners are never retired while a turn is running, and ensuring a planner does not bypass the
  daemon's run limits.
- **Specs and docs:** update `planning-sessions/storage`, `planning-sessions/v2-modal` and
  `planning-sessions/planner-tools`, and add the new routes to `docs/API.md`.

**BREAKING:** none for users or callers. The storage capability's one-drafting-plan requirement is
replaced, but the existing `POST /plans/start` contract (resume-or-create) is preserved.

## Capabilities

### New Capabilities
<!-- None: this change extends three capabilities that already exist. -->

### Modified Capabilities
- `planning-sessions/storage`: a project may hold several `drafting` plans; the drafting plans can
  be listed as tab summaries; a plan's title records whether it is auto-generated or captain-given;
  the planner is ensured per focused plan and retired when idle.
- `planning-sessions/v2-modal`: the surface is tabbed, with New plan, per-tab switch, delete with
  confirm, double-click rename, the AI title (or "New plan") on each tab, a remembered last-focused
  tab, and an empty state when a project has no drafting plan.
- `planning-sessions/planner-tools`: the planner can set its own plan's short title through a
  dedicated capability and can never overwrite a title captain renamed.

## Impact

- **DB:** `packages/db/src/migrations/0043_*.sql` — drop the unique index, add `plans.title_source`.
- **Shared:** `Plan` gains `titleSource`; a `PLAN_TITLE_SOURCES` enum; `weave_plan_set_title` in the
  tool registry (guarded by `packages/shared/src/tools.test.ts`); a `plan.titled` workspace event.
- **Core:** `packages/core/src/planning/index.ts` (list summaries, create without the guard, set
  title), `packages/core/src/api.ts` (service interface), `packages/core/src/workers/index.ts`
  (start/resume picks the most recent drafting plan, idle-planner retirement).
- **Server:** `packages/server/src/routes/projects.ts` (list/create/rename routes, scoped plan),
  `packages/server/src/tools.ts` + MCP registration for the planner title tool.
- **UI:** `packages/ui/src/v2/PlanModal.tsx` (tabs, New plan, delete confirm, rename, empty state),
  `packages/ui/src/api/hooks.ts` + `keys.ts` (list/create/rename queries).
- **Docs/tests:** `docs/API.md`; core `planning.test.ts`, server `plans.test.ts`, UI
  `v2planmodal.test.tsx`, and planning-session specs.
- **Not touched:** the live daemon, its config, its systemd unit, port 7433.
