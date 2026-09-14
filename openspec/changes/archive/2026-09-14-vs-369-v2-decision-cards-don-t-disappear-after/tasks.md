# Tasks

- [x] 1. `useAnswerDecision` (`packages/ui/src/api/hooks.ts`) removes the decision from every cached open-decisions list across workspaces in `onMutate`, snapshotting them; `status` sets that include `answered` (V1 chat's timeline) are left alone.
- [x] 2. `onError` restores the snapshot for every failure except a `wrong_status` refusal (a closed decision stays gone); one in-flight POST per decision id, so a double click cannot answer twice.
- [x] 3. V2 Needs you (`packages/ui/src/v2/NeedsYouPage.tsx`) and V2 Chat (`packages/ui/src/v2/ChatPage.tsx`) stop showing an error for a `wrong_status` refusal; a hold refusal (`revision_pending`) still shows its message.
- [x] 4. Tests: global Needs you and the chat pane path remove the card without a refetch; a double click posts once; `wrong_status` removes it with no error; a hold refusal keeps it and shows the message. V1's decision tests still pass.
- [x] 5. `pnpm lint`, `pnpm typecheck` and both test suites pass; both suite blocks pasted on the ticket.
- [x] 6. Live updates: `V2Shell` fans one event stream in per listed workspace on global pages, so `decision.created`/`updated`/`answered`/`superseded` reach the cross-workspace `useDecisionsMany` keys; tests flip a held card to approvable and add a card from delivered events (global Needs you and the Chat pane).
- [x] 7. Rendered check on an isolated scratch daemon (own `--config-dir`, non-7433 port, stopped by recorded PID): global Needs you and the Chat decisions pane in dark and light, removal-on-answer and the live held-to-approvable flip; list what was checked.
