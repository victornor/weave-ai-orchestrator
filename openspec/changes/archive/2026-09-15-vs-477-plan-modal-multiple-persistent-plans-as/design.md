## Context

See `proposal.md` — Why. This is the VS-398 planning-session lineage: `plans` and `plan_drafts`
(`packages/db/src/migrations/0041_plan_drafts.sql`), the `PlanningService`
(`packages/core/src/planning/index.ts`), the `planner` agent kind and its disposable worktree
(`packages/core/src/workers/index.ts` `ensurePlanner`/`retirePlanner`/`startOrResumePlan`), the plan
routes (`packages/server/src/routes/projects.ts`), and the V2 modal
(`packages/ui/src/v2/PlanModal.tsx`).

Constraints that shape the approach:

- SQLite cannot ALTER a partial index's predicate, but a partial **index** can simply be dropped;
  the one-drafting-plan rule lives entirely in `plans_one_drafting_per_project`.
- There is **no** utility/cheap model setting and **no** one-shot model-invocation path in the
  daemon. `WorkspaceModels`/`DaemonModels` expose only `weaver`, `workers` and a `workerOptions[]`
  catalog; every model call in the codebase goes through the run engine against a persisted agent
  and run (`packages/core/src/runs/engine.ts`).
- A plan already owns a `web` thread and a `planner` agent, and the planner is woken by messages on
  that thread like any other agent.
- `liveInProject` counts only `kind = 'worker'`, so planners do not consume a project's worker cap;
  a planner consumes a run slot only while it is actually taking a turn.

## Goals / Non-Goals

**Goals:**

- Several drafting plans per project, listed and driven as tabs, persisted server-side.
- Start a new plan, switch plans, delete a plan (without executing it), rename a plan.
- A short AI-generated title per plan, never overwriting a captain rename.
- Bounded planner resources across several tabs, preserving every plan's conversation and drafts.

**Non-Goals:**

- Changing what a submitted plan becomes, or the weaver handoff.
- Changing the planner's read-only scope or its draft-editing tools.
- Introducing a new cheap/utility model setting or a new model-invocation path (see Decision 2).
- A cross-project "all plans" view; tabs are scoped to one project at a time.

## Decisions

### Decision 1 — Storage: drop the unique index, add `title_source`

Migration `0043` drops `plans_one_drafting_per_project` and adds
`plans.title_source TEXT NOT NULL DEFAULT 'auto' CHECK (title_source IN ('auto','human'))`,
backfilling existing rows whose `title` is non-null to `'human'` (a title could only have been set at
creation by a caller, so it is captain's).

An alternative was to infer "auto" from `title IS NULL`, but an auto-generated title is non-null, so
a later regenerate could not be told apart from a captain rename. A source flag is the smallest thing
that makes "never overwrite a rename" enforceable. `getDrafting(projectId)` becomes "the most
recently created drafting plan" (ordered by `created_at`, then `id`) so `start`/`startOrResumePlan`
keep their resume-or-create contract.

### Decision 2 — Title generation runs on the planner's own turn, via a new tool

The planner names its plan through a new `weave_plan_set_title` MCP tool (added to `PLANNER_TOOLS`),
called on the turn the first human message already starts — which also produces the first draft. The
system prompt instructs the planner to name the plan from the conversation in at most six words,
before or alongside its first drafts, and to regenerate only if the title is still auto-generated and
the plan's scope clearly changed. `PlanningService.setTitle(actor, planId, title, source)` normalises
the text (trim, collapse whitespace, strip wrapping quotes), caps auto titles at six words, and
refuses to write when the stored source is `'human'`.

**This is a deliberate deviation from the ticket's literal "cheap model call on the smallest
configured model," and it is flagged for review here and on the ticket.** The reason is that no such
setting or call path exists: `quick`/`standard`/`deep` are worker *tiers* in the `workerOptions`
catalog, not a utility model control, and every model call is a run against an agent. Options
considered:

- *A separate one-shot run on the `quick` worker option.* Needs a synthetic agent and run (and the
  run engine's home/worktree/session/usage orchestration) for a six-word string, plus a new
  lifecycle to retire it. Rejected as disproportionate.
- *A direct provider HTTP call from the daemon.* A new credential path that bypasses the run engine's
  accounting and the "credentials are reached through the runtime" rule. Rejected.
- *Reuse the planner's already-started turn.* Costs one small tool call on a turn that is happening
  regardless, needs no new run, process, credential or setting, and has the conversation context a
  good title needs. Chosen.

The consequence is that an untitled plan shows **New plan** until the planner's first turn
succeeds; if that turn fails, the placeholder stands until the next turn or a manual rename. The
single `setTitle` seam means a future separate cheap call can fill the same method without a spec
change. If the reviewer wants the literal one-shot, Decision 2 is the only part to revise.

### Decision 3 — Tabs are server state; focus is local state

`GET /projects/:id/plans?status=drafting` returns summaries (id, title, titleSource, status, draft
count, createdAt, updatedAt), newest first. The modal renders one tab per summary. The tab *set* is
therefore server state and survives reload and another device. The *focused* tab is a device
preference, stored in `localStorage` under `plan:lastTab:<ws>:<projectId>`, falling back to the
newest drafting plan, and to the empty state when there are none.

### Decision 4 — Routes and services

| Route | Service call | Purpose |
|---|---|---|
| `GET /:id/plans?status=drafting` | `planning.listDrafting(projectId)` | tab summaries |
| `POST /:id/plans` | `workers.createPlan(actor, projectId)` | new drafting plan + thread + planner |
| `POST /:id/plans/:planId/activate` | `workers.ensurePlanner` + `workers.retireIdlePlanners(projectId, {keepPlanId})` | focus a tab; bounds idle planners |
| `PATCH /:id/plans/:planId` | `planning.setTitle(actor, planId, title, 'human')` | rename |
| `POST /:id/plans/start` | `workers.startOrResumePlan` | unchanged resume-or-create |
| `POST /:id/plans/:planId/discard` | `planning.discard` + `workers.retirePlanner` | delete a tab |

`createPlan` mints the planner agent id, creates the plan's own `web` thread, creates the plan, and
ensures the planner — the same ordering `startOrResumePlan` already uses, extracted so both paths
share it.

### Decision 5 — Planner lifecycle bounds resources without a background timer

Idle retirement is swept lazily at moments the modal is already talking to the daemon:
`POST /plans/:planId/activate` (on open and on tab switch) retires every planner in the project that
is not the focused plan's, has taken no turn within `PLANNER_IDLE_RETIRE_MS` (15 minutes) — measured
from the agent's `last_run_at`, falling back to the plan's `updated_at` — and has no running turn.
Discard/submit keep retiring their own planner as today. No scheduler or timer is added, so there is
nothing to reason about across a daemon restart.

Retirement removes only the planner's disposable worktree and agent row; the plan, its thread and
its drafts stay. Re-focusing calls `ensurePlanner`, which provisions a fresh planner and resumes the
thread's session the way reopening the modal does today. Only the focused plan's planner is
therefore resident at a time. A planner with a running turn is never retired. Planner runs go
through the ordinary dispatcher, so the daemon's run limit already applies; ensuring a planner does
not start a run (only a message does).

### Decision 6 — Delete is the existing discard, with a confirm

A tab's delete control shows an inline confirmation (not a browser `confirm`, so it is testable and
works on the phone sheet). Confirming calls the existing discard endpoint; the modal then removes the
tab and focuses the neighbor, or shows the empty state when it was the last. No tickets are created;
the plan and thread are kept as history.

## Risks / Trade-offs

- **The planner may not call the title tool** → the tab stays "New plan"; the system prompt makes the
  call expected, the tab is still fully usable, and a rename is one double-click away. Accepted.
- **Title tokens run on the weaver's model, not a cheap one** → one small tool call on a turn that
  already runs; bounded by the six-word cap; documented above with the alternative.
- **A reviewer wants a genuinely separate cheap call** → Decision 2 is isolated behind
  `planning.setTitle`, and would change only the caller of that method.
- **Retiring a planner the user was about to message again** → the 15-minute idle window is far
  longer than a tab switch, a running turn is never retired, and any retired planner is re-ensured on
  focus with its conversation intact.
- **Dropping the unique index silently allows many drafting plans** → intended; `listDrafting` orders
  newest first and `start` resumes the newest, so the pre-tabs behaviour is unchanged for a project
  with one plan.
- **The storage capability's Purpose sentence still says "never a second one"** → corrected directly
  in `openspec/specs/planning-sessions/storage/spec.md` as a task, since a delta cannot carry a
  Purpose for an existing capability.

## Migration Plan

1. Ship migration `0043`: drop the index, add `title_source` with its default and backfill.
2. Deploy daemon: existing projects keep their one drafting plan and gain `title_source`.
3. Rollback: restore the previous release; the dropped index and the extra column are inert to it
   (the old code neither reads nor relies on them), so no data migration is needed to roll back.

## Open Questions

None. The two decisions that could have changed the specs (title mechanism, lifecycle) are resolved
above; the title mechanism is flagged for review rather than left open.
