## 1. Server: bulk-withdraw a ticket's open decisions

- [x] 1.1 In `packages/core/src/api.ts`, add `withdrawForTicket(actor: Actor, ticketId: string, reason:
      string): number;` to the `DecisionsService` interface, next to `withdraw`/`supersedeForTarget`.
- [x] 1.2 In `packages/core/src/decisions/service.ts`, add a `withdrawOpenForTicket(actor, ticketId,
      reason)` helper parallel to `supersedeOpen` (lines 76-87): select every `id` from `decisions`
      where `workspace_id = ws AND ticket_id = ticketId AND status = 'open'`, and for each row set
      `status: 'withdrawn'`, `answerText: reason`, record a `decision.withdraw` activity with
      `{ reason }`, and emit `decision.answered` — the same write shape and event `withdraw()` (lines
      440-450) already uses for one decision. Expose the public method as `withdrawForTicket(actor,
      ticketId, reason) { return tx(db, () => withdrawOpenForTicket(actor, ticketId, reason)); }`,
      mirroring the `supersedeOpen`/`supersedeForTarget` pairing.
- [x] 1.3 Add tests in `packages/core/src/decisions/decisions.test.ts`: create a ticket with two open
      decisions of different kinds tied to it (e.g. `merge_approval` and a ticket-scoped `question`),
      plus one decision with no `ticketId` (e.g. `hire_approval`-shaped) and one already `answered`
      decision on the same ticket. Call `decisions.withdrawForTicket(actor, ticket.id, 'test reason')`
      directly and assert: both ticket-scoped open decisions are now `status: 'withdrawn'` with
      `answerText: 'test reason'`; the untied decision and the already-answered one are byte-for-byte
      unchanged; the return value equals the count actually closed.

## 2. Hook the closure into every path that reaches a terminal ticket status

- [x] 2.1 In `packages/core/src/tickets/service.ts`'s `propagateTerminal(t, actor)` (lines 207-229),
      after the existing dependent/parent logic, call `deps().decisions.withdrawForTicket(actor, t.id,
      \`${t.identifier} reached ${t.status}\`)` inside a `try { ... } catch (e) { log.warn({ err: e,
      ticketId: t.id }, 'closing open decisions for a terminal ticket failed'); }`, matching the
      existing defensive pattern around `supersedeForTarget` in `putDocument` (lines 276-280) — a
      failure here must never block the ticket from reaching its terminal state.
- [x] 2.2 Add tests in `packages/core/src/decisions/decisions.test.ts` (real `tickets` + `decisions`
      services wired together, per the file's existing harness) covering the acceptance criteria
      directly:
      - a `task` ticket with an open decision tied to it (`decisions.create(...)`) transitions
        `in_progress → done`; the decision is now `withdrawn`.
      - a `task` ticket with an open decision tied to it is `cancel()`led from `todo`; the decision is
        now `withdrawn`.
      - a ticket with a decision that was already `answered` before the ticket reaches `done`; the
        decision's fields are unchanged after the transition.
- [x] 2.3 Confirm (read-only, no code change expected) that `mergeDone()`'s call to `propagateTerminal`
      (line 809) and `cancel()`'s call (line 638, inside its own transaction) both pick up the new
      behavior for free, since they call the same function — note this in the PR description rather
      than duplicating the hook.

## 3. Verification

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` green.
- [x] 3.2 `openspec validate vs-142-a-decision-whose-ticket-has-reached-a-te --json --strict` clean.
