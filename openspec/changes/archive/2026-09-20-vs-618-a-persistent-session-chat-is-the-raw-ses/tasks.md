## 1. A session turn with no final text posts nothing

- [x] 1.1 In `packages/core/src/runs/engine.ts`, stop posting `This turn ended without an answer.` from `deliverSessionAnswer`'s `succeeded` branch: when the trimmed final text is absent, whitespace-only or report-shaped, write no message and return; keep the `extractReport` guard (no report JSON in a chat) and keep `sessionOutcomeNotice` untouched. Verify: `engine.test.ts`'s null / whitespace / report-shaped cases each assert zero thread messages for the run, and `pnpm vitest run packages/core/src/runs/engine.test.ts` is green
- [x] 1.2 Confirm the terminal-outcome path still posts exactly one notice naming the cause: failed (including quota and auth), timed out, cancelled and non-resuming interrupted each assert one system notice with no run id. Verify: the existing outcome-notice tests pass unchanged

## 2. The conversation's ordered rows

- [x] 2.1 Add a pure `sessionConversationRows(messages, runs, sessionAgentId)` (`packages/ui/src/lib/sessionConversation.ts`) returning time-ordered rows of `{ kind:'message', message }` and `{ kind:'turn', run }`: inbound human messages, system notices and other agents' messages stay; the session's own outbound answer messages (agent-authored, `authorId === sessionAgentId`, with a `runId`) are dropped; each run is ordered by `startedAt ?? createdAt` with a stable tie-break. Verify: a unit test covers the order across two human messages, a tool-only turn with no thread message, a weaver relay, a system notice and a dropped delivered answer
- [x] 2.2 In `SessionThreadFeed` (`packages/ui/src/v2/WorkerPage.tsx`), read the session's runs from the shared `useRuns({ limit: 200 })` query filtered by `agentId` (the query `useWorkerRun` already makes, so it is not a new request), feed them and `useThreadMessages` through 2.1, and drop the `useLiveRunSettle` / `threadRunIds` replacement logic. Verify: the feed renders the same rows across a rerender and shows no turn twice

## 3. Each turn's transcript, live and after

- [x] 3.1 Add `packages/ui/src/v2/SessionTurn.tsx` composing the existing pieces without a nested scroller: `Transcript` for the run's persisted events, plus `LivePartials` and `LiveActivity` while the run is live, driven by `useRunEventStream(runId, { live })`; no `RunTranscript` scroll box and no "not sent yet" label. Verify: a component test mounts a run mid-turn and after, asserting the same transcript structure before and after with no second `role="log"` scroller
- [x] 3.2 Render `SessionTurn` for every turn row in `SessionThreadFeed`, below the preceding messages, keeping a `system` notice as a centred muted notice. Verify: the session feed renders a run's `Transcript` between two human messages
- [x] 3.3 Add the final-text-once safety net: pass the turn's dropped delivered answer text (if any) into `SessionTurn`, and when a finished turn's transcript produced no assistant-text block, render that text once as the turn's closing text. Verify: a run whose events carry the answer shows it once with no separate bubble, and a run with no text event but a delivered answer still shows the answer once

## 4. The ticketless session's instruction

- [x] 4.1 Add `SESSION_NOW` and branch `whatToDoNow` (`packages/core/src/prompts/index.ts`) so a ticketless `session` gets it instead of `WORKER_DELIVERY_NOW` (answer the conversation in its own words; write the reply as the final message; no report format); a ticketed session keeps the worker instruction. Verify: `render.test.ts` asserts the ticketless session's turn prompt contains the conversation instruction and not `do the phase your ticket status asks for` / `structured final report`, and that the weaver, planner and worker prompts are unchanged

## 5. Tests and verification

- [x] 5.1 UI tests in `packages/ui/src/test/v2worker.test.tsx`: a session turn that ends after a tool result renders no notice and no error; a failed turn renders its real reason as a system notice; turns between two human messages show tool rows, an edit diff, a written-file preview and command output; the final text appears once. Verify: the session-feed test file is green
- [x] 5.2 Re-check the design's audit table against the merged base and correct it if a surface moved; say so in the report
- [x] 5.3 `openspec validate vs-618-a-persistent-session-chat-is-the-raw-ses --json --strict` is clean before requesting review
- [x] 5.4 `pnpm lint && pnpm typecheck` green, then the full suite one suite at a time with `--maxWorkers=4`, pasting both suite blocks verbatim in the report

## 6. Evidence and closing

- [x] 6.1 Capture rendered evidence in both themes (dark, light) at desktop and phone width: a session chat with several turns including one diff and one command, mid-turn and after the turn ends, compared against the worker live view. Attach each capture to the ticket (`weave_ticket_attachment_put`) so it appears on the approval card; author any harness outside `work/` and remove it, leaving `git status --porcelain` empty
