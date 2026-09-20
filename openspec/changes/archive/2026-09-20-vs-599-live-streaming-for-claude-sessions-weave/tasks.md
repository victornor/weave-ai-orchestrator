## 1. Claude adapter streams

- [x] 1.1 Add `--include-partial-messages` to both invocation heads in `packages/runtimes/claude/src/args.ts` (the `--input-format text` and `--input-format stream-json` forms) and assert it in `test/args.test.ts` for both forms
- [x] 1.2 Declare `partialOutput: 'full'` in `capabilities` in `packages/runtimes/claude/src/adapter.ts` and add `claude: 'full'` to `RUNTIME_PARTIAL_OUTPUT` in `packages/shared/src/events.ts`; verify the adapter test pins the declaration to that table

## 2. Parser translation (`stream_event` → partials and completed ids)

- [x] 2.1 Consume `stream_event` lines in `createClaudeParser`: track the message id from `message_start` and the block index from `content_block_start`, and stop emitting persisted `runtime.raw` for them; verify with an `events.test.ts` case that a `stream_event` line yields no persisted event
- [x] 2.2 Report `text_delta` and `thinking_delta` as `RuntimePartial`s of kind `text` / `thinking` through a drained `takePartials()`; consume `signature_delta` with no output; verify in `events.test.ts` for delta ordering, per-kind reporting and that a signature never appears in events or partials
- [x] 2.3 Bind `tool_use` (`content_block_start`) to its tool id and block index, report `input_json_delta` as `tool_input` partials carrying that `toolCallId`, and stamp a `partId` of `${message.id}:${blockIndex}` on every emitted `assistant.text` / `assistant.thinking` / `tool.call`; verify in `events.test.ts` that the completed event's `partId` matches its partials and that exactly one `tool.call` is emitted per tool with the full input
- [x] 2.4 Assert no double-count: the completed `assistant` line still produces the same persisted events and `state.assistantText` is not touched by deltas; verify with an `events.test.ts` case comparing a streamed run against the same run's completed-line output

## 3. Adapter wiring and fixtures

- [x] 3.1 Wire the parser's partials to `sink.onPartial` in `adapter.ts`'s stdout handler (after `emit(line)`), for both the live-input and headless paths; verify with a fake-CLI test that `onPartial` sees the deltas and `onEvent` sees only completed events
- [x] 3.2 Extend `test/fakeCli.ts` to emit `stream_event` lines (`message_start`, `content_block_start`/`delta`/`stop`, whole `assistant` lines, `result`) and drive `test/adapter.test.ts` and `test/liveInput.test.ts` through it; verify the live-input form streams and still resumes/cancels as today
- [x] 3.3 Add `fixtures/stream-events-text.jsonl` (thinking then text, per the captured protocol incl. the `signature_delta`) and `fixtures/stream-events-tool.jsonl` (a tool-use block with `input_json_delta` then the completed line and `user` result), transcribed from the 2026-09-20 capture; verify `events.test.ts` parses both in order
- [x] 3.4 Test the edges over the fixtures: a stream cut off after deltas without the completed line (no invented `assistant.text`, unchanged exit/session/error), and a cancel mid-stream clearing the partials; verify both in `test/`

## 4. Weaver chat is a live run surface

- [x] 4.1 Add an optional `runtimeId` to `ChatConversationProps` (`packages/ui/src/v2/ChatConversation.tsx`), pass the weaver's from `ChatPage.tsx` and the planner's from `PlanTab.tsx`, and stop discarding the stream's `partials` / `lastPartialAt` / `partialSince`
- [x] 4.2 Render `LiveActivity` and `LivePartials` in `LiveSection` in place of the bare `working` line, keeping the compaction row and the dropped-stream notice; verify with a component test that a live weaver run shows streaming text and the activity row and never a bare `working`
- [x] 4.3 Assert streaming cannot reach the human channel: a `run.delta` frame with text produces no `ChatMessage` and no thread row; verify with a `ChatConversation` test
- [x] 4.4 Component test that a chat run on a runtime with no partial output shows the whole-steps-only statement with elapsed time, tool count and time since the last event

## 5. Evidence, measurement and full suites

- [x] 5.1 Measure the fake-CLI latency from `onPartial` to the rendered `LivePartials`, and state the chat's before (bare `working`, no text) and after (streaming text + activity row) in the report; state plainly that the real-CLI haiku number is left to the owner (the credential rule forbids the live run)
- [x] 5.2 Capture rendered evidence in both themes at desktop and phone width for the weaver chat mid-turn and a Claude worker page mid-turn (streaming text, thinking, a running tool, waiting for the model) from a scratch harness outside the worktree, and attach the images to the ticket
- [x] 5.3 Run `pnpm lint` and `pnpm typecheck` green, then the core/server suite and the UI suite one at a time at `--maxWorkers=4`, and paste both suite blocks verbatim into the ticket
