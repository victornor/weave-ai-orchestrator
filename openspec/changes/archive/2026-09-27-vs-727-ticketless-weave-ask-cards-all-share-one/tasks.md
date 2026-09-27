## 1. Fix the default correlation key

- [x] 1.1 In `packages/core/src/decisions/service.ts` `create()`, change the default `correlationKey`
      expression so: a ticket-scoped ask (`requestedTicketId` set) keeps deriving
      `${kind}:${owner}:${requestedTicketId}` unchanged; a ticketless ask of an askable kind
      (`question`, `concern`, or `gate_finding`) derives a key unique to this call instead of the
      shared `${kind}:${owner}:workspace` bucket, reusing the decision's own `id` (already generated
      via `newId()`) as the uniqueness source; every other kind (the system-owned approval kinds)
      keeps deriving `${kind}:${owner}:workspace` exactly as today. Verify by reading the diff: the
      ticket-scoped branch and the non-askable-kind ticketless branch are textually identical to
      today's expression, and only the askable-kind ticketless branch can never equal a previous
      call's key.
- [x] 1.2 Update the `weave_ask` tool description in `packages/server/src/tools.ts` to state exactly
      when a new card supersedes an old one: ticket-scoped same kind + owner always does; ticketless
      only does when the caller passes the same explicit `correlationKey` on both. Verify by reading
      the rendered description back through `weave_ask`'s schema/tool listing.

## 2. Tests

- [x] 2.1 In `packages/core/src/decisions/decisions.test.ts`, add a test that two ticketless
      `question` asks (no `ticketId`, no explicit `correlationKey`) naming different `projectId`s
      both stay `open`. Verify: `pnpm vitest run packages/core/src/decisions/decisions.test.ts`.
- [x] 2.2 Add a test that two ticketless `question` asks with no `ticketId`, no `projectId`, and no
      explicit `correlationKey` both stay `open`. Verify: same file, same run.
- [x] 2.3 Add a test that two ticketless asks of the same kind and owner sharing an explicit
      `correlationKey` still supersede (the earlier becomes `superseded`, the later `open`). Verify:
      same file, same run.
- [x] 2.4 Add a test that the fix applies the same way to `concern` and to `gate_finding`, not only
      `question`: two ticketless asks of one of those kinds, no explicit key, both stay `open`.
      Verify: same file, same run.
- [x] 2.5 Add or confirm a test that a ticket-scoped repeat ask (same ticket, same kind, no explicit
      `correlationKey`) still supersedes exactly as before (VS-519 behavior unchanged) — extend the
      existing "a repeat ask by the same owner still supersedes" case if it does not already cover
      the no-explicit-key default path. Verify: same file, same run.
- [x] 2.6 Add a test (in `decisions.test.ts`, calling `decisions.create` directly with `kind:
      'retry_approval'`, no `ticketId`, and each call's own explicit `correlationKey:
      \`retry:${agentId}\`` the way `runs/engine.ts` `parkForHuman` does) that two ticketless
      `retry_approval`s for the same agent still supersede, and two for different agents both stay
      `open` — a regression guard confirming the askable-kind scoping in 1.1 leaves this system kind's
      existing per-agent dedup untouched. Verify: same file, same run.
- [x] 2.7 Run the full core/server suite and the UI suite once each
      (`pnpm test`, capped per the project's test-runner conventions) and confirm both are green;
      no test starts or stops the live daemon.

## 3. Validate and deliver

- [x] 3.1 `openspec validate vs-727-ticketless-weave-ask-cards-all-share-one --json --strict` is
      clean.
- [x] 3.2 `pnpm lint && pnpm typecheck` pass.
- [x] 3.3 Commit, push, open the pull request, and record the work product.
