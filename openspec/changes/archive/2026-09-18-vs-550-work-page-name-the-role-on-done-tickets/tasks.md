## 1. Core plan-origin read

- [x] 1.1 Add a `PlanOrigin` shape (`ticketId`, `planId`, `planTitle`, `planStatus`, `dispatched`) to `packages/shared`, and `planning.planOriginForTicket(ticketId)` plus `planning.listPlanOrigins()` to `packages/core/src/planning/index.ts` and its `api.ts` interface. `dispatched` is true when the plan has no `submitted_at` or the linked ticket's `created_at` is earlier than it. Verify with a core unit test covering a drafting-plan dispatch, a submitted-plan submission-time ticket, a submitted-plan early dispatch, and an unlinked ticket returning null.
- [x] 1.2 Expose the read: add `plan` to the ticket detail response in `packages/server/src/routes/tickets.ts`, and a workspace-scoped `GET /plan-origins` returning `{ origins }`. Verify with route tests (detail includes the origin; the bulk route lists it; an ordinary ticket returns null / is absent), and update `docs/API.md`.

## 2. UI data access

- [x] 2.1 Add `usePlanOrigins()` (`packages/ui/src/api/hooks.ts`) and its type (`packages/ui/src/api/types.ts`), mapping the bulk read to `ticketId → PlanOrigin`. Verify the hook is typed against the route and `pnpm --filter @weave-ai/ui typecheck` passes.

## 3. Part 1 — name the role on finished tickets

- [x] 3.1 Add a pure `ticketAssigneeLabel({ liveWorkerName, roleName, historicalWorkerName })` to `packages/ui/src/v2/work/board.ts` (live worker → role → historical worker → `unassigned`) and unit-test the three precedence cases.
- [x] 3.2 Wire the label into `Work.tsx`: build a role-name map from `useRoles()`, set it on `WorkRow`, and render the label on the kanban card, the table row and the phone row. Verify with a component test that a done ticket with a role renders the role while an in-progress ticket with a live worker renders the worker.
- [x] 3.3 Apply the same label on the ticket page (`packages/ui/src/v2/ticket/Ticket.tsx`) using the `role` already on `TicketDetail`. Verify with a component/unit test.

## 4. Part 2 — landing vs waiting, position, and a reachable summary

- [x] 4.1 Add a pure merge-state model (over the loaded tickets, grouped by project, using `compareMergeQueue` and `mergeWaitPhase`/`mergeWaitLabel`) returning per-ticket `landing | waiting`, a 1-based position, and the landing wait phase. Unit-test landing detection from `mergeStartedAt`, position order, and the CI/worker phase.
- [x] 4.2 Render the state on the kanban card, the table row and the phone row (`Work.tsx`), and turn the merge strip's landing count, waiting count, active landing ticket and next waiting ticket into links to their ticket pages. Verify with component tests that a landing and a waiting ticket render differently and that activating a strip figure opens the expected ticket.

## 5. Part 3 — plan origin on the card and the ticket page

- [x] 5.1 Render the plan origin: a plan tag on the kanban card (plan name plus a `dispatched while drafting` / `filed at submission` distinction) and a plan row on the ticket page, with the plan name linking to the surface plans open on today (the weaver chat), behind one small link helper. Verify with component tests that a dispatched ticket, a submission-time ticket and an ordinary ticket render as the spec requires.

## 6. Evidence and delivery

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test` (both the core/server and UI suite blocks) and confirm green, pasting both blocks in the PR.
- [x] 6.2 Build the UI and capture the Work screen and a ticket page in light and dark themes at desktop and phone width, showing a done ticket beside an in-progress one, a landing ticket beside queued ones, and a planner-dispatched ticket beside a submission-time one; attach the captures to VS-550 with `weave_ticket_attachment_put`.
- [x] 6.3 Commit, push the branch, open the PR, record the work product and transition VS-550 to `in_review`.
