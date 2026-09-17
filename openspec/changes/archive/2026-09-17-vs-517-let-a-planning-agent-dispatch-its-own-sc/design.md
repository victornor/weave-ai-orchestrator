## Context

Planning already runs a `planner` agent kind that is ticketless by design: `WorkersService.ensurePlanner`
spawns an `agents` row with `ticket_id: null, plan_id: <plan>` (`packages/core/src/workers/index.ts`),
read-only against the project, retired on idle timeout or when the plan leaves `drafting`
(`retirePlanner`, which also clears `plans.agent_id` and deletes the agent's pending wakeups). A plan's
drafts (`plan_drafts`) already carry a `status` of `pending | created | failed` and a `createdTicketId`,
written today only by `weave_plan_draft_link` — a `weaver`-scoped tool the weaver calls once per draft
while processing a `plan_submitted` wake (`packages/core/src/prompts/index.ts`).

Today, nothing routes a ticket's completion to anything other than: (a) its parent ticket's worker, via
`children_completed`, or (b) the single per-workspace weaver, via the periodic `conductorDigest()` sweep
(`packages/core/src/supervisor/index.ts`). There is no existing "report to something other than the
weaver" path, and no ticket field records who dispatched it for the purpose of routing its report — see
`proposal.md` for why the digest path is wrong for a scout that exists specifically to inform a plan
still being written. Tool availability is already a fixed whitelist per agent kind (`PLANNER_TOOLS` in
`packages/shared/src/tools.ts`, enforced in `packages/server/src/tools.ts`'s `toolNamesFor`), which is
how `planning-sessions/planner-tools` guarantees the planner has no ticket-creation tool today — this
change adds exactly one narrowly-scoped tool to that list, restricted identically to captain's own Plan
modal action, rather than widening `weave_ticket_create` itself. Captain asked for dispatch to stop
requiring a click per scout (his live plan has 15–20 pending drafts); giving the planner the same
narrow capability, alongside the modal button, is what actually removes that friction — the weaver's
own concern on the first pass of this change was scope (scout drafts and nothing else), not who
initiates.

## Goals / Non-Goals

**Goals:**
- Let a `scout` draft become a real ticket before its plan is submitted, dispatched by the planning
  agent itself.
- Route that ticket's report to the planning agent's own plan while the plan is `drafting`, never to
  the weaver.
- Make dispatch state part of the same draft lifecycle (`status`/`createdTicketId`) plan submission
  already understands, so no separate bookkeeping is needed to avoid double-filing.

**Non-Goals:**
- Letting the planner dispatch anything but a `scout` draft (explicitly out of scope in the ticket).
- Changing what a scout ticket does once it is running, or how it delivers its report document.
- Changing plan submission's own behavior for drafts that were never dispatched.
- A general "report to an arbitrary agent" mechanism — this is a scout-to-its-own-planner path only.

## Decisions

### How a report reaches a ticketless agent

**Decision:** add one wake source, `scout_report`, enqueued directly at the plan's planner `agentId` —
never at `conductorId()`/`workers.conductor()`. It is raised from the same place a ticket's terminal
transition already looks at (`propagateTerminal` in `packages/core/src/tickets/service.ts`), extended
with one more lookup: given a terminal ticket, find a `plan_drafts` row whose `createdTicketId` matches
it (a new indexed reverse lookup added to `PlanningService`, e.g. `findDraftByTicket(ticketId)` — one
query, no schema change to `tickets`). If found and that draft's plan is still `drafting`:
1. Call `workers.ensurePlanner(actor, planId)` — the same call tab-focus already makes
   (`planning-sessions/storage`'s "Focusing a tab ensures its planner") — so an idled-out planner is
   live again before the wake is enqueued.
2. `wake(agent.id, 'scout_report', reason, { ticketId, draftId, planId })`.

This reuses the existing "ensure a planner" entry point instead of inventing a second one, and reuses
the existing generic `wake()` primitive (`wake.enqueue` already accepts any `agentId`) instead of
inventing a new delivery mechanism. The planner then reads the report on its next turn through the
**same tool it already uses to read its plan**: `weave_plan_get`'s per-draft payload gains the linked
ticket's current status and, once terminal, its report document's body, keyed off `createdTicketId` —
so no new read-scoped tool is needed and the planner's read boundary (its own plan, nothing else) is
preserved by construction rather than by a second permission check.

**Alternatives considered:**
- *Route through the ticket's own worker-report path, addressed at the planner as if it were a
  ticket owner.* Rejected — a ticket's "owner" today is a role/worker, not an arbitrary agent, and
  bending that concept for one case (rather than adding a lookup at the one call site that needs it)
  would touch far more of `tickets/service.ts`.
- *A new dedicated `weave_plan_draft_report` tool.* Rejected as unnecessary surface — the planner
  already calls `weave_plan_get` on every turn touching its plan; folding the report in there is one
  fewer tool to document and no less discoverable, since the draft it belongs to is right there.
- *Poll instead of wake.* Rejected — the planner is turn-based like every other agent; a poll would
  mean either a timer wake (wasteful, adds latency) or is simply a wake by another name.

### What happens to a dispatched scout when its plan is discarded, submitted, or the planner idles out

**Decision:** the ticket is never cancelled by a plan-status change — it is a real ticket per the
proposal's "invisible work is worse than inconvenient work," and cancelling running work because of an
event on a different object (the plan) is a worse surprise than letting it finish. What changes is only
whether its eventual completion still tries to reach a planner:

- **Planner idled out, plan still `drafting`:** re-ensure it (see above) — this is the transient,
  expected case the storage capability already designed for.
- **Plan `discarded`:** the scout keeps running; on completion, `findDraftByTicket` still finds the
  draft, but its plan's status is no longer `drafting`, so no `ensurePlanner`/`scout_report` wake is
  attempted. The ticket finishes as an ordinary ticket — visible on the work page, subject to the
  workspace's ordinary stalled-worker detection and digest, same as one the weaver had filed directly.
- **Plan `submitted`:** identical fallback. The weaver's plan-submission processing skips this draft
  (see below), so by the time the scout finishes, nothing in the system still expects to hear about it
  through the planning path — it is just a ticket. If another draft in the same plan depended on it,
  that dependent's real ticket was created with a real `blockedBy` on this ticket, so the *existing*
  `blockers_resolved` propagation (unrelated to this change) already wakes that dependent's worker when
  this scout finishes — no special case needed.

This keeps the rule uniform and easy to state: **a dispatched scout's report reaches a planner only
while its plan is `drafting`; the moment the plan leaves that status, the scout is indistinguishable
from a ticket the weaver filed itself.** No new terminal-status branching, no "was this scout abandoned"
flag to maintain.

**Alternatives considered:**
- *Cancel a still-running scout when its plan is discarded.* Rejected — destroys work in progress for
  a plan the human is free to reconsider later (nothing stops filing an identical scout by hand), and
  contradicts "the scout is a real ticket."
- *Keep trying to reach the (gone) planner after discard, and drop the report if it can't.* Rejected —
  adds a "planner not found" failure path for no benefit over simply not trying, and needlessly
  special-cases discard versus submission versus a scout that finishes cleanly during drafting.

### Whether a dispatched scout draft is still a draft, and what stops it being filed twice

**Decision:** dispatch writes to the **same fields** post-submission linking already writes —
`plan_drafts.status = 'created'`, `createdTicketId = <ticket id>` — via the existing `linkDraft`
service method, called from the new dispatch path instead of only from `weave_plan_draft_link`. The
draft row is untouched otherwise: it keeps its position, title, and place in the list, so it is still
"a draft" for every purpose except being eligible for (re-)dispatch or being picked up by submission's
ticket-creation loop. The weaver's plan-submission processing (`prompts/index.ts`'s `plan_submitted`
instruction, and `weave_plan_get`'s `creationOrder`) is changed to only walk drafts whose `status` is
still `pending` — a `created` or `failed` draft (whether from a prior dispatch or, as already happens
today, a genuinely failed submission-time creation) is skipped, and a dependent draft's `blockedBy`
resolves to the already-existing `createdTicketId` instead of a freshly created one.

This is the same mechanism the storage capability already specified for a submission-created draft
("A draft records whether and how it became a real ticket") — dispatch is simply an earlier writer of
the same state, not a new state machine.

**Alternatives considered:**
- *A separate `dispatched` boolean, distinct from `status`.* Rejected — would need its own
  double-filing check plus the existing `status` check, two things to keep in sync for one concept
  ("this draft already has a ticket").

### Who owns a dispatched scout ticket for supervision

**Decision:** nobody new. The workspace's existing stalled-worker detection
(`worker-supervision/stalled-worker-detection`) already applies "independent of ... who created it" —
it is keyed off the ticket/agent/run state, not off a creator. A dispatched scout that genuinely stalls
still raises `worker.stalled`, visible through the weaver's digest, exactly as any stalled ticket would.
This is not a contradiction of "the weaver receives no wake from the dispatch, the report, or the
completion" in the acceptance criteria — a stall is none of those three things; it is the existing
safety net for a worker nothing else can revive, and it is the only path left once a scout's plan can
no longer receive its report. No new ownership concept, no new supervisor code path.

**Alternatives considered:**
- *Have the planner supervise its own dispatched scouts.* Rejected — the planner is a `persistent`
  turn-based agent that only runs when woken; it cannot poll, and giving it a supervision role would
  require the very timer/poll machinery already rejected above.

## Data model

- `plan_drafts`: no new columns. Dispatch reuses `status`/`createdTicketId` via `linkDraft`.
- `tickets`: no new columns. The scout's plan/draft is found by reverse lookup
  (`plan_drafts.createdTicketId = ticket.id`), not stored on the ticket — keeps `planning-sessions` a
  planning-owned concept the `tickets` table doesn't need to know about.
- `packages/shared/src/enums.ts`: `WAKE_SOURCES` gains `'scout_report'`.
- `packages/shared/src/tools.ts`: `PLANNER_TOOLS` gains one new tool, `weave_plan_draft_dispatch`,
  restricted identically to the HTTP route (both call the same `PlanningService.dispatchDraft`).
- `weave_plan_get`'s response shape (and the equivalent HTTP `GET .../plans/:planId`) gains an
  optional per-draft `ticketStatus`/`report` field, populated only for a draft with a
  `createdTicketId`.

## Risks / Trade-offs

- **[Risk]** A scout ticket's report document schema/kind might not be uniformly named across scout
  worker deliveries, making the `weave_plan_get` enrichment's "read the report" step ambiguous. →
  **Mitigation:** apply-phase reads the same document kind the `weave-ai-scout` skill already
  standardizes on for every scout ticket; this is not a new format, just a new reader.
- **[Risk]** `ensurePlanner` inside a ticket-transition code path pulls worker-provisioning
  (worktree creation, git identity) into a code path (`tickets/service.ts`) that today has no such
  dependency, risking a boundary violation or a slow ticket transition. → **Mitigation:** call it via
  the existing `deps()` indirection `tickets/service.ts` already uses to reach other services, and keep
  the call fire-and-forget/best-effort relative to the transition itself (the transition must not fail
  or block because a planner is slow to provision) — schedule it rather than await it inline, mirroring
  how other post-transition side effects in that file are scheduled.
- **[Risk]** Dispatch is a irreversible, real action (spawns a worker, consumes a role slot) triggered
  from a modal that otherwise only edits local draft state — a captain could dispatch by accident. →
  **Mitigation:** this is a product/UX judgement call within the accepted design (a confirming affordance
  or none), left to the apply-phase implementation; it does not change the spec's behavior contract.
- **[Risk]** Giving the planning agent the same dispatch capability risks it dispatching scouts on its
  own initiative mid-conversation, more often than captain actually wants. → **Mitigation:** the tool's
  description frames it as something the planner does when the conversation calls for it (the same way
  `weave_plan_draft_add` already is), not automatically; this is the same trust boundary the planner's
  other write tools already sit inside (it already adds/edits/removes drafts on its own judgement), and
  dispatch is scoped no wider than they are — one scout, one draft, one already-existing role.

## Migration Plan

No data migration beyond an index on `plan_drafts.created_ticket_id`. `WAKE_SOURCES` gains an additive
entry; existing plans, drafts and tickets are unaffected until a draft is dispatched for the first
time. No rollback concern beyond a normal revert.
