## 1. One live section for every conversation

- [x] 1.1 Extract the non-compacting live body of `ChatConversation.LiveSection` into a shared `packages/ui/src/v2/LiveTurnSection.tsx` — the activity row always, and when `showOutput` (default `true`) the streamed text (`LivePartials`) and the live trace (`ChatTrace`, only with events) inside a container labelled `Live run output — not sent yet` (`data-live-run-view` / `data-live-run-view-label`) — and have `ChatConversation` delegate to it while keeping the compaction row and the dropped-stream retry; verify the planner chat and worker feed are unchanged (`pnpm --filter @weave-ai/ui exec vitest run src/test/v2chat.test.tsx src/test/v2chattrace.test.tsx src/test/v2plantab.test.tsx src/test/v2feed.test.tsx`)

## 2. The weaver chat's stream is opt-in, off by default

- [x] 2.1 Add `packages/ui/src/lib/liveRunPrefs.ts` (`readShowLiveRunOutput` default `false`, `writeShowLiveRunOutput`, `useShowLiveRunOutput` following a same-document event and `storage`) with a unit test that the default is off, a round trip survives, and a write publishes
- [x] 2.2 Add `showStreamedOutput?: boolean` to `ChatConversation` forwarded to `LiveTurnSection.showOutput`, and pass `useShowLiveRunOutput()` from `ChatPage`; verify `PlanTab` renders no prop and still streams
- [x] 2.3 Add the switch to Settings → This device → Chat in `packages/ui/src/settings/sections.tsx` beside "Turns with no reply", with `role="switch"`, an aria-label, and a detail line saying off shows only sent messages plus the activity row, on shows in-progress output, stored in this browser only
- [x] 2.4 Add component tests: default off renders no `[data-live-partials]` and no `[data-trace-tool]` in the weaver chat (only sent messages and `[data-live-activity]`); a write of `true` makes the stream and trace render with `[data-live-run-view-label]`; the delivered message replaces the stream with its text shown exactly once

## 3. The session chat's live turn

- [x] 3.1 In `SessionThreadFeed` (`packages/ui/src/v2/WorkerPage.tsx`), render the shared `LiveTurnSection` for the session agent's current run, below the thread's delivered messages, and add the component test that a live session turn renders `[data-live-partials]` streamed text and `[data-trace-tool]` rows beside the activity row
- [x] 3.2 Hold the finished run on screen until the thread carries its answer or its run-id-carrying system notice (`useLiveRunSettle` plus a render guard on the thread's run ids), and add the component test that the delivered message replaces the live section with the text shown exactly once and no live section left
- [x] 3.3 Add the component test that a turn ending without an answer is replaced by its system notice the same way, and that a run on a runtime declaring no partial output renders `[data-live-whole-steps]`
- [x] 3.4 Re-check the audit table in design.md §1 against the merged base; correct it if a surface changed, and note the result in the report

## 4. Evidence and closing

- [x] 4.1 Capture rendered evidence in both themes at desktop and phone width: the weaver chat switch off and on (on showing the labelled in-progress run output); a session chat mid-turn with streamed text and a tool call and the moment the final message replaces it; a non-streaming runtime session — compared against the worker live view, and attached to the ticket
- [x] 4.2 `pnpm lint && pnpm typecheck` green, then one full suite at a time with `--maxWorkers=4`, pasting both suite blocks verbatim in the report