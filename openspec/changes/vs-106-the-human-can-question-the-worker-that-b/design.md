## Context

See `proposal.md` — Why. Everything the ticket asks for maps onto machinery that already ships:
`agent-attach/live-input` (VS-99) for delivery, `human-decisions/option-cards` (VS-92) for answering
the merge approval, `TicketPage`'s Activity tab for the recorded, attributed feed, and `PlanTab`'s
embedded decision actions as the pattern for embedding `merge_approval`'s. This document is about the
three gaps in `proposal.md` and how each is closed with the smallest change that closes it.

## Goals / Non-Goals

**Goals:**

- A ticket's worker is nameable and its session's resumability is knowable even after the worker that
  built the PR has retired — reading history must not depend on a column that retirement nulls.
- Sending into a retired worker fails loud, at the point of sending, not silently as a "queued"
  delivery that will never be read.
- One feed, one composer, one set of end actions (approve / ask for revisions) — reached from two
  entry points (the merge-approval card, the PR view) rather than two different conversations.
- Reuse the live-input mechanism and the decision-answer mechanism exactly as they exist; this change
  adds no new delivery path and no new decision kind.

**Non-Goals:**

- A dedicated "conversation" data model separate from ticket comments. The KB and PLAN already treat
  a ticket as a conversation (`packages/core/src/tickets/service.ts`'s `comment()`, `TicketPage`'s
  Activity tab); this change does not introduce a second thread concept alongside it.
- Changing `merge_approval`'s answer semantics. `applyMergeApproval` already treats `approve` as one
  path and any other key carrying text as the other (`decisions/service.ts:167`); this change only
  gives the human a place to press those two buttons without leaving the conversation.
- Reconnecting to a *stale* session mid-conversation. A session goes `stale` after
  `defaults.sessionMaxIdleDays` of no turns (`sessions/index.ts:44`) regardless of this change; a
  worker sitting in `in_review` for that long already starts fresh on its next turn today, and
  `sessionResumable` reports that honestly rather than trying to prevent it.

## Decisions

### 1. `TicketsService.lastWorker` promotes the existing internal lookup

`latestWorkerFor(ticketId)` already exists (`tickets/service.ts:393`) and is already used internally
by `retry`. It is added to the public `TicketsService` interface (`core/src/tickets/service.ts`'s
exported type, and `packages/core/src/api.ts`) as `lastWorker(ticketId): Agent | null`, unchanged in
implementation. `GET /tickets/:id` (`routes/tickets.ts:48`) changes from

```ts
worker: ticket.workerId ? safe(() => s.workers.get(ticket.workerId!)) : null,
```

to

```ts
const workerId = ticket.workerId ?? s.tickets.lastWorker(ticket.id)?.id ?? null;
worker: workerId ? safe(() => s.workers.get(workerId)) : null,
```

*Alternative considered:* have `tickets.get()` itself carry the last worker id. Rejected — `Ticket` is
the row; a ticket that has never had a worker must not gain a phantom field, and every other reader
of `Ticket` (the board, the list, activity) has no use for it. The fallback belongs at the one call
site that assembles ticket *detail* for display, which is already where `mergeQueue` and
`openspecState` are assembled the same way.

### 2. `sessionResumable` is a `WorkersService` method, not a new service on `CoreServices`

`agent_sessions` is owned by a `SessionsService` instance created privately inside
`createWorkers(ctx)` (`workers/index.ts:33`) — it is not on `WorkspaceContext` and routes cannot reach
it directly. Rather than promoting `sessions` to a shared context member (which the KB already flags
as breaking every test harness that proxies an unstubbed `CoreServices` member into a throw, for a
single boolean), `WorkersService` gains one method:

```ts
sessionResumable(id: string): boolean {
  return sessions.active(id) !== null;
}
```

`GET /workers/:id` (`routes/workers.ts:17`) adds `sessionResumable: s.workers.sessionResumable(worker.id)`
alongside its existing `input: safe(() => describeLiveInput(...))`. True exactly when the agent's
`agent_sessions` row is still `status: 'active'` — closed by retirement, gone stale by idle time. This
is the one plain, checkable fact behind "the same agent, with its own session and context" — it says
nothing about whether a *turn* is running right now (that's `input.midTurn`), only whether the next
one would resume rather than start over.

### 3. `WorkersService.message` refuses a retired worker before writing anything

```ts
async message(actor, workerId, body, opts = {}) {
  const agent = get(workerId);
  if (agent.status === 'retired') {
    throw new OcError('wrong_status', `${agent.name} has retired; reply on the ticket to reopen it instead`);
  }
  ...
```

Placed before the ticket comment is written (unlike every other guard in `message`, which acts after
recording — here there is nothing worth recording: the words were never sent to anyone, so recording
them as delivered-or-queued would misstate what happened). The error message names the actual way
back in — `tickets.comment` (`service.ts:632`) already reopens a done/cancelled ticket and relaunches
or spawns a worker on a plain human comment; that path is untouched and remains how a landed ticket
is reopened for more work. This change only stops a live-input *send* from pretending a retired agent
will read it.

*Alternative considered:* let it through and rely on the UI to never call it for a retired worker.
Rejected — `ac_worker_message` and `POST /workers/:id/message` are also reachable by the conductor and
by `conductor attach`; a guard only in one UI component is not a guard.

### 4. The Activity tab's composer switches on `worker.status`, not on ticket status

Three states, driven entirely by `detail.data.worker` (now populated even after retirement, per
decision 1) and a `useWorker(worker.id)` call for `input`/`sessionResumable` (exactly the pair
`WorkerPage` already reads):

| `worker` | `worker.status` | Composer |
|---|---|---|
| `null` | — | today's plain `usePostComment` composer, copy unchanged ("a worker is started for this ticket…") |
| present | not `'retired'` | `useWorkerMessage()` with `live: true`, `queuedReason` from `input.midTurn`/`reason` exactly as `WorkerPage` computes `steerLabel`, worker named in the placeholder |
| present | `'retired'` | no composer; a note naming the worker and that its session is gone, with the existing `usePostComment` reply retained below it only when the ticket is not itself terminal (a `blocked`/`in_progress` ticket can still legitimately gain a comment that reopens or redirects it) |

Ticket status is not the switch because a ticket can be `in_review` with a live, un-retired worker
(the exact case this ticket is about) or `done` with a worker not yet swept by `retireFinished` (a
narrow race, made harmless by switching on `worker.status` rather than assuming the two always agree).

*Alternative considered:* a `conversationState` field on ticket detail computed server-side.
Rejected — every input it would need (`worker.status`, `input.midTurn`, `sessionResumable`) is already
two existing queries the page can make; a third derived shape would have to be kept in sync with both
for no reader other than this one tab.

### 5. `merge_approval`'s actions are embedded the way `plan_approval`'s already are

`PlanTab` (`TicketPage.tsx:217`) fetches `useDecisions({ status: 'open', owner: 'human' })`, finds the
one for this ticket, and renders its own Approve/Revise/Composer UI rather than rendering
`<DecisionCard>` inside the tab. The Activity tab gains the identical shape for `merge_approval`:
`answer.mutate({ id, key: 'approve' })` for "Approve merge", and a `Composer` that submits
`answer.mutate({ id, key: 'changes', text })` for "Ask for revisions" — `applyMergeApproval` already
treats any non-`approve` key carrying text as the request-changes path
(`decisions/service.ts:167-178`). Note this is `'changes'`, not `'revise'`: unlike `plan_approval`'s
options (`approve`/`revise`/`reject`, `service.ts:348-350`), a `merge_approval` decision's real
options are `approve`/`changes` (`service.ts:370-374`) — `decisions.answer` validates a supplied key
against the decision's own options and rejects any other, so the button must use the key the decision
actually offers, not `PlanTab`'s. No decisions-service change.

Placed above the feed, exactly where `PlanTab` places its banner, so approving or revising is always
in the same view as the question that led to it — never a separate control the human has to leave the
conversation to reach.

### 6. Deep-linking: `?tab=` on the ticket route, entry points at both call sites

`TicketRoute`'s `tab` state (`TicketPage.tsx:52`, currently local-only) is read from and written to
the URL via `useSearchParams`/`useGo`, the same pattern `Board` uses for `?project=` and Settings for
`?section=` (both cited in the KB as the precedent to follow — "link by key, never by tab position").
`Tabs`' `onChange` calls both `setTab` and a URL update so a reload or a shared link lands on the same
tab.

- `PullRequestsSection`'s existing ticket link (`PullRequestsSection.tsx:114`, `:189`) adds
  `search={{ tab: 'activity' }}`.
- `DecisionCard` gains an "Ask the worker" text link, shown only when `decision.kind ===
  'merge_approval'` and `decision.ticketId` is set, next to the existing buttons, pointing at
  `/w/$ws/tickets/$ticketId?tab=activity`. It needs `ws` to build the path; `DecisionCardProps` gains
  an optional `ws?: string`, passed from `Chat.tsx` and `NeedsYou.tsx` (both already hold it via
  `useWs()`) — kept a prop rather than a hook call inside `DecisionCard`, consistent with every other
  piece of context that component already receives as a prop (`ticketIdentifier`, `projectSlug`,
  `askedBy`) rather than fetching for itself.

## Risks

- **A worker mid-turn while the human presses "Approve merge."** Unchanged from today: answering the
  decision transitions the ticket to `merging` regardless of whether a turn is executing; this change
  does not touch that path. Out of scope per the ticket ("no change to who may approve a merge, or to
  the merge queue").
- **`sessionResumable` flips to `false` between the human reading it and pressing send**, if the
  worker's session goes stale in that window. Harmless: the next turn simply starts fresh, which is
  exactly what `sessionResumable: false` already told the human could happen; `WorkersService.message`
  does not itself depend on the session being active (only `agent.status !== 'retired'`).

## Migration

None. `lastWorker` and `sessionResumable` are additive reads; the `message` guard only changes
behavior for a call that today silently failed to reach anyone. No schema change, no config change.
