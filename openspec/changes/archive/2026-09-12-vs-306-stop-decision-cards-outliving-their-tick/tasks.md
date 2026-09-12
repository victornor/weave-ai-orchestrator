## 1. Stop attaching a decision to an already-terminal ticket

- [x] 1.1 In `packages/core/src/decisions/service.ts`'s `create()`, resolve the named ticket's status:
      if the ticket is `done` or `cancelled`, create the decision with no ticket attachment
      (`ticketId = null`) while deriving its project **and its correlation key** from the original
      ticket before detaching, and log a warning naming the ticket and the decision kind. Deriving the
      key from the original ticket (not the emptied attachment) keeps the detached card in its own
      bucket and out of the shared `question:workspace` bucket. A ticket that is not terminal, or no
      ticket at all, is unchanged. Verify by reading `create()` that the insert's `ticketId` is null
      only on the terminal branch, that `resolveProject` still returns the ticket's project, and that
      the correlation key is computed from the original `input.ticketId`.
- [x] 1.2 Cover it with a test built from the real shape in
      `packages/core/src/decisions/decisions.test.ts`: a `question` created seconds after its ticket
      reached `done` is created, open, answerable, keeps the ticket's project, and has a null ticket
      attachment. Add the mirror case (a decision on a live ticket keeps its attachment), the
      no-ticket case, and the correlation-key case: a decision detached from a terminal ticket does
      not supersede an open `question:workspace` card, and a subsequent workspace-level `question`
      does not supersede it. Run the decisions suite.

## 2. Add the stale-terminal sweep

- [x] 2.1 Extend `withdrawOpenForTicket` in `packages/core/src/decisions/service.ts` with an optional
      created-before filter so the sweep reuses the existing closure path (status `withdrawn`, reason
      in `answerText`, `decision.withdraw` activity, `decision.answered` event), rather than adding a
      second closure mechanism.
- [x] 2.2 Add `sweepTerminalTickets(actor, olderThanMs)` to the decisions service: it finds each
      distinct ticket that is terminal and carries at least one `open` decision older than the cutoff,
      and withdraws those stale decisions through `withdrawOpenForTicket` with the created-before
      filter. Add the method to `DecisionsService` in `packages/core/src/api.ts`.
- [x] 2.3 Wire it into `packages/core/src/supervisor/index.ts` on the same cadence as
      `approvalIntegrityScan` (inside the `LIVENESS_EVERY_MS` block), with a named 24-hour grace
      constant and its rationale in a comment; a failure is logged, never fatal.
- [x] 2.4 Test in `packages/core/src/decisions/decisions.test.ts`: a stale (`created_at` older than
      the grace) `open` decision on a `done` ticket is withdrawn; a fresh one on the same ticket is
      not; an `open` decision on a live ticket is untouched when the sweep runs; and a re-raised
      approval for a non-terminal ticket is untouched by a following sweep. Run the decisions suite.
- [x] 2.5 Test in `packages/core/src/supervisor/supervisor.test.ts` that a supervisor tick withdraws
      a stale open decision on a `done` ticket and leaves an open decision on a live ticket alone.
      Run the supervisor suite.

## 3. Show age and ticket status in the weaver's open-decision lines

- [x] 3.1 In `packages/core/src/prompts/index.ts`, change the weaver's open-decisions query to join
      `tickets` for the identifier and status, and format each line as
      `- <id> [<kind>, owner <owner>[, <identifier> <status>], <age>] <title>`, with the age from
      `formatAge` (`@weave-ai/render`) kept **last** so the eye lands on it. A decision with no ticket
      shows no ticket segment. Leave the cap of 8 and the oldest-first order unchanged.
- [x] 3.2 Extend the weaver prompt test in `packages/core/src/prompts/render.test.ts` to assert an
      open decision's line carries its age and its ticket's identifier and status. Run the prompts
      suite.

## 4. Verify the whole change

- [x] 4.1 Run `pnpm lint` and `pnpm typecheck` green.
- [x] 4.2 Run `pnpm test`; paste both suite blocks verbatim in the report (core/server, then UI).
- [x] 4.3 Confirm no decision-creation path bypasses the guard in a way that leaves a new decision
      attached to a terminal ticket (read the `decisions.create` call sites), and state in the report
      whether the `briefing/service.ts` newest-first `needsYou` ordering is worth its own ticket.
