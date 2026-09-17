## Why

A scout draft exists to inform the plan it belongs to, but today it can only become a real ticket
after captain submits the whole plan — so the information a scout was meant to supply arrives after
the decision it was meant to inform. Captain has a live plan with 14 drafts (3 scouts) and cannot run
the scouts without either submitting an unfinished plan or abandoning the scouting entirely. Captain
chose the narrowest fix: let a scout draft — and only a scout draft — be dispatched from an unsubmitted
plan, with its report routed to the planning conversation, not the weaver.

## What Changes

- A scout draft in a `drafting` plan gets a **Dispatch** action in the Plan modal, and the planning
  agent gets the same capability as a tool, restricted identically. Either one files a real ticket for
  that draft alone, immediately (not automatically, and not for `change`/`task`/`operational` drafts,
  which stay unfiled until submission) — captain's ask was to stop having to click through pending
  scouts one at a time, so both paths exist and either can be used.
- The dispatched ticket is ordinary in every way that matters for supervision, visibility and the work
  page: real worker, real run, real report document. What differs is who is told when it finishes.
- The scout's report reaches the **planning agent**, in the plan's own conversation, while the plan is
  still `drafting`. The weaver is not woken by the dispatch, the run, or the completion.
- A new wake path carries a finished dispatched-scout's report to its plan's planner, re-ensuring a
  live planner if the previous one had idled out, without going through the weaver or through a ticket
  the planner owns (the planner still owns no ticket).
- A draft's dispatch is recorded on the same `status`/`createdTicketId` fields a post-submission
  linked draft already uses, so the weaver's plan-submission processing (unchanged in its own
  behavior) already skips a draft that is not still `pending` — a dispatched scout is never re-filed
  when the plan is later submitted.
- Once a plan leaves `drafting` (submitted or discarded), a dispatched scout still running falls back
  to ordinary ticket behavior: no planner to report to, so it is left to the same generic
  stalled-worker detection and weaver digest every other standalone ticket already relies on. It is
  never cancelled by the plan leaving `drafting`.
- The Plan modal shows, per scout draft, whether it is still a draft, dispatched and running, or
  reported — without a trip to the work page.

## Capabilities

### New Capabilities
- `planning-sessions/scout-dispatch`: the dispatch action itself — who may call it, what ticket it
  creates, how the resulting ticket's report is routed back to the planning agent while the plan is
  still drafting, and what happens once it is not.

### Modified Capabilities
- `planning-sessions/planner-tools`: the existing, unqualified "the planner can never create a real
  ticket" requirement needs a narrow, explicit carve-out — a scout draft in the planner's own
  `drafting` plan, and nothing else, matching exactly what captain's own Plan-modal action allows.
- `planning-sessions/v2-modal`: the draft list needs a per-scout-draft dispatch action and a visible
  dispatch state, scoped to `drafting` plans.
- `planning-sessions/weaver-handoff`: plan-submission ticket creation must not re-file a draft that
  was already dispatched before submission.

## Impact

- `packages/core/src/planning/index.ts`, `packages/core/src/tickets/service.ts`,
  `packages/core/src/workers/index.ts` (re-ensuring a plan's planner outside of tab-focus),
  `packages/core/src/wake/*` (a new wake source), `packages/shared/src/enums.ts` (the new wake
  source), `packages/shared/src/tools.ts` and `packages/server/src/tools.ts` (a new `planner`-scoped
  dispatch tool, and an enrichment of `weave_plan_get`'s draft entries with the linked ticket's live
  status and report), `packages/server/src/routes/projects.ts` (a new dispatch route for captain's own
  action, and the same enrichment for the HTTP plan-read route the UI uses), `packages/core/src/prompts/index.ts`
  (the `scout_report` wake's prompt injection), `packages/ui/src/v2/PlanModal.tsx` (the dispatch
  control and status display).
