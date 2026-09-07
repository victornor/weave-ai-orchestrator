## 1. A ticket's worker survives its own retirement, for reading

- [x] 1.1 Promote `latestWorkerFor` (`packages/core/src/tickets/service.ts:393`) to a public
  `lastWorker(ticketId): Agent | null` on `TicketsService`'s exported interface and on
  `packages/core/src/api.ts`; verify `pnpm typecheck` passes and the existing `retry` call site
  (`service.ts:646`) still compiles unchanged.
- [x] 1.2 Change `GET /tickets/:id` (`packages/server/src/routes/tickets.ts:48`) to resolve `worker`
  from `ticket.workerId ?? s.tickets.lastWorker(ticket.id)?.id`; verify a server test that a ticket
  whose worker has retired (worker `status: 'retired'`, `ticket.workerId` null) still returns that
  worker in its detail, and that a ticket that never had a worker still returns `worker: null`.
- [x] 1.3 Update `docs/API.md`'s `GET /tickets/:id` entry to say `worker` names the last worker that
  held the ticket, not only the current one; verify the entry reads correctly against the new
  behavior.

## 2. Whether a worker's session can still be resumed

- [x] 2.1 Add `sessionResumable(id: string): boolean` to `WorkersService`
  (`packages/core/src/workers/index.ts`), implemented as `sessions.active(id) !== null` using the
  module's existing private `sessions` instance; add it to the interface in `packages/core/src/api.ts`.
- [x] 2.2 Add `sessionResumable` to `GET /workers/:id`'s response (`packages/server/src/routes/
  workers.ts:17`), alongside the existing `input`; verify a server test: `true` for a worker with an
  active session, `false` once `sessions.close` has run (mirroring how the existing test for `input`
  is written).
- [x] 2.3 Update `docs/API.md`'s `GET /workers/:id` entry with the new field.

## 3. A live-input send refuses a retired agent

- [x] 3.1 In `WorkersService.message` (`packages/core/src/workers/index.ts:229`), throw
  `OcError('wrong_status', ...)` naming the agent and that reopening the ticket is the way back in,
  when `agent.status === 'retired'`, before the ticket comment is written; verify a core test that no
  comment is recorded and no wake is enqueued when this fires.
- [x] 3.2 Verify a core test that a non-retired worker's `message` call is unaffected (mid-turn and
  queued cases both still pass as they do today).
- [x] 3.3 Verify the same guard is exercised through both entry points that call `message`: `POST
  /workers/:id/message` and the `ac_worker_message` tool — a server test and an `mcp.test.ts` case
  each asserting the call surfaces the `wrong_status` error rather than a 200/ok result.
- [x] 3.4 Update `docs/API.md`'s `POST /workers/:id/message` entry to name this refusal.

## 4. The ticket page's tab is addressable by URL

- [x] 4.1 In `packages/ui/src/routes/TicketPage.tsx`, read the initial tab from `useSearchParams()`
  (falling back to `'overview'`) and write it back via `useGo`'s `search` on every `Tabs onChange`,
  the same pattern `Board.tsx` uses for `?project=`; verify a ui test that `/tickets/:id?tab=work`
  renders the Work tab and that changing tabs updates the URL.

## 5. The Activity tab talks to the worker directly

- [x] 5.1 In `TicketPage.tsx`'s `ActivityTab`, when `detail.data.worker` is present and its
  `status !== 'retired'`, fetch `useWorker(worker.id)` for `input`/`sessionResumable` and replace the
  `usePostComment` composer with `useWorkerMessage()` called with `live: true`, mirroring
  `WorkerPage.tsx`'s `steerLabel`/outcome handling exactly (same draft key, so the two composers keep
  sharing one draft as they do today); verify a ui test that sending posts through the worker-message
  path and shows the mid-turn/queued outcome.
- [x] 5.2 When `worker.status === 'retired'`, render a read-only note naming the worker and that its
  session is gone instead of the worker-message composer; verify a ui test for this state, including
  that no request is made if the human types and the composer is absent.
- [x] 5.3 When there is no worker at all, verify the existing `usePostComment` composer and copy are
  unchanged (regression coverage for the current behavior).

## 6. The merge-approval decision is answerable from the Activity tab

- [x] 6.1 In `ActivityTab`, fetch the ticket's open `merge_approval` decision the same way `PlanTab`
  fetches its `plan_approval` (`useDecisions({ status: 'open', owner: 'human' })` filtered by
  `ticketId`/`ticketIdentifier`); render an "Approve merge" button calling
  `answer.mutate({ id, key: 'approve' })` and an "Ask for revisions" button that opens a `Composer`
  submitting `answer.mutate({ id, key: 'changes', text })` (`merge_approval`'s real non-approve
  option, not `plan_approval`'s `'revise'`), placed above the feed; verify a ui test for
  both actions and that neither renders when no merge approval is open.
- [x] 6.2 Verify a ui test that approving or revising from the Activity tab leaves any other open
  decision on the ticket untouched (asserting the mock for `useDecisions` still shows it).

## 7. Entry points

- [x] 7.1 Add `ws?: string` to `DecisionCardProps` (`packages/ui/src/components/DecisionCard.tsx`);
  when `decision.kind === 'merge_approval'` and `decision.ticketId` and `ws` are both set, render an
  "Ask the worker" link to `/w/$ws/tickets/$ticketId?tab=activity`; verify a component test that the
  link is present only for a `merge_approval` card with both values set, and absent otherwise.
- [x] 7.2 Pass `ws={ws}` from the two call sites (`packages/ui/src/routes/Chat.tsx:646,745` and
  `packages/ui/src/routes/NeedsYou.tsx:119`), both of which already hold `ws` via `useWs()`; verify
  `pnpm typecheck` and the existing tests for both routes still pass.
- [x] 7.3 Add `search={{ tab: 'activity' }}` to `PullRequestsSection.tsx`'s ticket links
  (`packages/ui/src/routes/project/PullRequestsSection.tsx:114`, `:189`); verify a ui test that the
  link's target includes the search param.

## 8. Fake-runtime verification and cleanup

- [x] 8.1 Verify end to end against `FakeRuntime`, no real CLI: a merge-approval conversation on an
  in-review ticket delivers mid-turn while the worker's turn is executing; queues when it is not;
  approving from inside the conversation transitions the ticket to `merging` exactly as the card's
  own approve does; asking for revisions answers the decision and sends the text to the worker;
  sending to a worker that has since retired is refused with a clear error and the past exchange
  still renders, naming that worker.
- [x] 8.2 Update `docs/PLAN.md` wherever it describes the merge-approval card's actions or the
  project overview's pull request links, to match what shipped.
- [x] 8.3 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm --filter @agent-conductor/ui exec vitest run`; verify all four are green and that no test
  drives a real CLI.
