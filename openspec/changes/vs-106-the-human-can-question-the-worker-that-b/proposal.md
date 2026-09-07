## Why

Captain (2026-09-07): "There should be an option to chat with the worker who implemented a PR. This
way the user can enquire about implementation details, ask for reasoning, implementation summary
etc. This may lead to the user approving the PR or the user asking for some revisions."

Today a merge approval is a yes-or-no against a summary the conductor relayed. The one agent that can
actually answer "why did you do it that way" — the worker, holding the full context of the work — is
idle and unreachable from the place the decision is made. The human's only route is a ticket comment,
delivered on the worker's next wake, which is not a conversation.

Most of what this needs already exists and works:

- `agent-attach/live-input` (VS-99) already delivers a human's text to a worker's executing turn
  where the runtime supports it, queues it otherwise, and reports which happened. `WorkersService.
  message` (`packages/core/src/workers/index.ts:229`) already records the exchange on the ticket
  before attempting delivery.
- `TicketPage`'s Activity tab (`packages/ui/src/routes/TicketPage.tsx:292`) already renders the
  ticket's comments and runs as one ordered feed — "the ticket is a conversation" is already the
  model; the composer there just posts a plain comment (`usePostComment`) rather than using the live
  path, so it does not report mid-turn-vs-queued and does not know it is talking to a specific
  worker.
- `human-decisions/option-cards` (VS-92) already answers a `merge_approval` decision with `approve`
  (→ `merging`) or any other key carrying text (→ ticket comment + back to `in_progress`) — the
  "revise" path the ticket asks for already exists; `PlanTab` (`TicketPage.tsx:217`) already shows
  the pattern of embedding a decision's answer actions inside a ticket tab, for `plan_approval`.
  `merge_approval`'s card has no such composer yet (`DecisionCard.tsx:422`, "Approve merge" / "Hold"
  only).
- The project overview's Pull requests section (VS-97) already links each PR to its ticket
  (`PullRequestsSection.tsx:114`).

Three real gaps stand between that and what the ticket asks for:

1. **The worker disappears from the record once it retires.** `GET /tickets/:id` resolves `worker`
   from `ticket.workerId` only (`packages/server/src/routes/tickets.ts:48`), and `retireIfLanded`
   nulls that column on retirement (`workers/index.ts:398`) even though the agent row and its ticket
   id survive. Once a ticket reaches `done`, its detail can no longer say who built it or whether that
   worker's session is still around to resume.
2. **Nothing stops a message from being sent into the void.** `WorkersService.message` does not check
   whether the worker has retired; it would still record the comment and enqueue a wake that no
   worker will ever pick up, which is a silent failure dressed as a queued delivery — not the "clear
   note" the ticket asks for.
3. **There is no entry point.** Neither the merge-approval card nor the PR view links to the ticket's
   conversation, and the ticket page's tab is not addressable by URL, so nothing can deep-link into
   it. The Activity tab's composer does not use the live path, does not identify the worker by name,
   and there is no way to end the conversation with approve/revise without leaving it.

## What Changes

- **A ticket's worker survives its own retirement, for reading.** `TicketsService` gains a public
  `lastWorker(ticketId)` (promoting the existing internal `latestWorkerFor` used by `retry`); the
  ticket detail route falls back to it when `ticket.workerId` is null, so a merged ticket still names
  who built it.
- **`GET /workers/:id` (and ticket detail's embedded worker) says whether its session is resumable** —
  a new `sessionResumable: boolean`, true exactly when `sessions.active(agentId)` still returns a row
  — so the interface can say "this is the same agent, its context is intact" or say plainly that it
  is not, rather than imply continuity it cannot deliver.
- **`WorkersService.message` refuses a retired worker** with a clear `wrong_status` error instead of
  recording a comment and queuing a wake nobody will read — a conversation on landed work fails loud,
  not silent.
- **The ticket page's tab is addressable by URL** (`?tab=`), the same pattern as Settings' `?section=`
  and Board's `?project=`, so a card or PR row can deep-link straight to the conversation.
- **The Activity tab's composer becomes the live-input path** when the ticket has a worker to talk to:
  it posts through `workers.message({ live: true })` instead of a plain comment, names the worker,
  and reports mid-turn-vs-queued exactly as `WorkerPage`'s composer does today — the same mechanism,
  a second surface. When the ticket's worker has retired, the composer is replaced with a read-only
  note naming who built it and that its session is gone.
- **An open `merge_approval` decision for the ticket is embedded in the Activity tab**, the same
  pattern `PlanTab` already uses for `plan_approval`: "Approve merge" answers it with `approve`;
  "Ask for revisions" opens a composer and answers it with the human's text on the existing non-
  approve path. Neither button is new decision machinery — both call the endpoint `DecisionCard`
  already calls.
- **The merge-approval decision card and the PR view both link to this conversation** — `DecisionCard`
  gains an "Ask the worker" link next to its existing buttons, and `PullRequestsSection`'s ticket link
  carries `?tab=activity`, so the human always lands on the same feed doing the asking, the approving
  and the revising.

## Capabilities

### New Capabilities

- `human-decisions/reviewer-conversation`: opening a conversation with the specific worker that
  produced a PR, from the merge-approval card or the PR view; the exchange recorded and attributed on
  the ticket; ending it by approving the merge or asking for revisions, and no other way to land or
  reject the work from inside it; a worker awaiting review not retired while the conversation is
  live; and a conversation on work that has already landed being read-only, with a clear note, rather
  than silently talking to nobody.

### Modified Capabilities

- `agent-attach/live-input`: a live-input send now refuses a retired agent rather than recording and
  queuing into nothing.
- `human-decisions/option-cards`: the merge-approval card links to a conversation with the worker
  that asked it.
- `project-overview/pull-requests`: a pull request's ticket link opens directly on that ticket's
  conversation with its worker.

## Impact

- `packages/core`: `tickets/service.ts` (`lastWorker`), `workers/index.ts` (`message` guard,
  `sessionResumable`), `sessions/index.ts` (no change — `active()` already answers this), `api.ts`
  (wire shapes for both).
- `packages/server`: `routes/tickets.ts` (worker fallback), `routes/workers.ts`
  (`sessionResumable` on detail).
- `packages/ui`: `TicketPage.tsx` (URL-addressable tab, live-input composer, embedded merge-approval
  actions, read-only note), `DecisionCard.tsx` (the "Ask the worker" link),
  `project/PullRequestsSection.tsx` (`?tab=activity` on the ticket link).
- `docs/API.md`: the two changed response shapes.

## Out of scope

Carried over from the ticket: the in-app diff viewer, any change to who may approve a merge or to the
merge queue, and conversations with a worker that has already been retired *and* whose worktree is
gone (that is exactly the read-only case above, not a new one).
