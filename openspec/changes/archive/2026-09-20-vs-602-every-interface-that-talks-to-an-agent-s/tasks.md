## 1. Slice 1 — the shared line and the board's frame

- [x] 1.1 Add the pure `liveTurnLine(t: LiveTurn): string` to `packages/render` (using `clock`), giving the same words for every surface; golden tests for each state (streaming, thinking, running `<tool> <target>`, waiting for the model, starting, whole steps only, a long tool-only turn)
- [x] 1.2 Enrich the `worker.activity` payload in `packages/shared` and `packages/core/src/activity` with the `liveTurn` fields (`state`, `label`, `toolCount`, `turnMs`, `sinceLastMs`), computed from the run's events so the board never needs a per-card stream; the service test asserts the frame carries them at the activity cadence (≤ one per 2 s)

## 2. Slice 2 — web conversations and role sessions

- [x] 2.1 Wire `LiveActivity` (and `LivePartials` inside the run-view section) into `ChatConversation.LiveSection`, replacing the literal "working"; forward a `runtimeId` prop from `ChatPage` (conductor) and `PlanTab` (planner); keep the compaction row; component tests for the weaver chat and the planner chat that a live run never renders a bare working state, and a test that a streaming weaver turn creates no outbound thread message. (The chat wiring itself was delivered by VS-599 while this was being planned; this change keeps it and adds the test that streamed text never travels the outbound path.)
- [x] 2.2 Add the live activity row and a `useRunEventStream` subscription to `SessionThreadFeed` for a ticketless role session's active run, with a component test that a live session never renders an idle-looking thread

## 3. Slice 3 — the remaining web surfaces

- [x] 3.1 Render the enriched `worker.activity` fields on the Work board cards and the ticket header via `LiveActivityLine`, replacing the bare "Working" fallback with the state word and elapsed time; component tests for a mid-turn board card and ticket header
- [x] 3.2 Show the live state and elapsed time on active rows of `RunsPage`; component test
- [x] 3.3 Use `liveTurn` for the V2 decision card's held-revision row and add the live row to the V1 decision card where the decision names a run; component tests

## 4. Evidence and closing

- [x] 4.1 Rendered evidence in every theme (dark, light) at desktop and phone width for the weaver chat mid-turn, the planner chat mid-turn, a role session mid-turn and a board card mid-turn; attach to the ticket
- [x] 4.2 `pnpm lint && pnpm typecheck && pnpm test` green (one full suite at a time, `--maxWorkers=4`), pasting both suite blocks in the report

---

**Follow-ups (filed, blocked on this ticket; both reuse `liveTurnLine`):** VS-603 takes the TUI and the CLI follow output (the old tasks 4.1-4.4); VS-604 takes the channel progress contract, the `ChannelManager` driver and Telegram (the old tasks 5.1-5.4), with progress text kept to generic state only. Their brief is design.md §1 and §4-5.