## 1. Planner dispatch tool carries the ticket identifier

- [x] 1.1 In `packages/server/src/tools.ts`, change the `weave_plan_draft_dispatch` handler to look up
      the created ticket after `dispatchDraft` and return `{ ...draft, ticketIdentifier }` (`null` when
      `createdTicketId` is null); update the tool's `description` to say the result carries
      `ticketIdentifier` and that the planner should name it in its next `weave_plan_reply`. Verify with
      an updated assertion in `packages/server/test/planTools.test.ts`'s existing VS-517 dispatch test
      (`linkedDraft.ticketIdentifier` matches the fake ticket's `identifier`).
- [x] 1.2 In `templates/planner.AGENTS.md.tmpl`, extend the hard rule about `weave_plan_draft_dispatch`
      (rule 3) to tell the planner to name the returned `ticketIdentifier` in its next reply, instead of
      just describing that it dispatched something. Verify `pnpm vitest run packages/core/src/prompts/render.test.ts`
      still passes (it only asserts the tool name appears, not the exact sentence).

## 2. Planning chat wires real tickets/workers into the shared chip renderer

- [x] 2.1 In `packages/ui/src/v2/PlanTab.tsx`, import `useTickets`/`useWorkers` from `../api/hooks` and
      call them with the same params `ChatPage.tsx` uses (`{ limit: 200, includeTerminal: true, fields:
      'label' }` and `{ includeRetired: true }`); pass their data into `chatEntries(messages.data ?? [],
      tickets.data ?? [], workers.data ?? [])` in place of the two empty arrays.
- [x] 2.2 Add a `renderAfterTrace` callback to `PlanTab.tsx` that renders `V2TicketStrip` (imported from
      `./ChatChips`) with `references={entry.references}`, `projectIds` computed from the `projects`
      prop, and `open={openTicket}` (the existing `useTicketLink()` result); pass it to `<ChatConversation
      renderAfterTrace={renderAfterTrace} .../>`. Update the file's top doc comment: dispatch chips are
      no longer in the list of weaver-only extras this tab omits.
- [x] 2.3 Update `packages/ui/src/test/v2plantab.test.tsx`'s mocked `../api/hooks` module to add
      `useTickets`/`useWorkers` (backed by new `state.tickets`/`state.workers` arrays, defaulting to
      `[]`, reset in `resetState`).
- [x] 2.4 Replace the existing test `'renders no ticket strip for a planner message that names a ticket
      (VS-634)'` (it asserts the old, now-wrong behavior) with a test that seeds `state.tickets` with a
      matching ticket and asserts a `[data-v2-ticket-strip]` **does** render, showing the identifier and
      status, and that clicking the chip calls `openTicket`/the chat's link handler (mock `useTicketLink`
      the same way the weaver chat's own tests do, or assert via `state.go`/navigation if that is how
      `useTicketLink` is mocked elsewhere).
- [x] 2.5 Add a test: a message anchored to a run that also produced a dispatched-scout ticket (matching
      `runId`/`createdRunId`, `assigneeRoleId` set, no identifier in the message body) renders a chip for
      it — proving the chip is derived from the dispatch link, not the prose.
- [x] 2.6 Add a test: expanding a chip's chevron in the plan tab renders the inline `TicketActivityFeed`
      panel (mock `useTicketComments`/`useTicketRuns` as `v2ticketchippanel.test.tsx` does), and the chip
      body's click still opens the ticket without toggling the panel.
- [x] 2.7 Run `pnpm vitest run packages/ui/src/test/v2plantab.test.tsx packages/ui/src/test/v2chat.test.tsx`
      and confirm both pass.

## 3. Full verification

- [x] 3.1 Run `pnpm lint && pnpm typecheck` and confirm both are clean.
- [x] 3.2 The full `pnpm test` run OOM'd the worker at the 8 GB limit; substituted per the weaver's
      relaunch guidance with targeted runs at `VITEST_MAX_WORKERS=2` (paste in the delivery report):
      `v2plantab.test.tsx`, `v2chat.test.tsx`, `v2ticketchippanel.test.tsx`, `planTools.test.ts`,
      `render.test.ts` — all green. The weaver re-runs full checks at review.
- [x] 3.3 Captured light- and dark-theme screenshots of the plan tab after a scout dispatch (collapsed
      and expanded, both themes — 4 images), against a throwaway scratch daemon seeded with a real
      workspace/project/plan (via onboarding) plus a directly-seeded ticket/messages standing in for a
      finished planner turn — never a live agent run. Attached to the ticket.
