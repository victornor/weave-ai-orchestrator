## 1. Capture the real shapes first

- [x] 1.1 Cursor: write `packages/runtimes/cursor/fixtures/stream-partial-output.jsonl` from the installed `cursor-agent` 2026.09.10 bundle's `stream-json` writer — several `assistant` text deltas, the whole-text flush before a `tool_call`/`started`, the `tool_call`/`completed`, a second message's deltas and turn-end flush, and `result` — with a header comment stating it is bundle-derived, not recorded, and why the CLI was not run (the platform rule); note the exact delta and flush field shapes in the fixture's doc comment
- [x] 1.2 Gemini: write `packages/runtimes/gemini/fixtures/streaming-deltas.jsonl` from the installed gemini 0.60.0 bundle's `stream-json` emit sites — an `init`, a `tool_use`/`tool_result`, several assistant `message` events with `delta: true`, and a `result` — with a header stating it is bundle-derived and that no non-delta completion message exists

## 2. Cursor adapter

- [x] 2.1 Add `--stream-partial-output` to `buildArgs` (only ever alongside the existing `--print --output-format stream-json`), covered by an args test
- [x] 2.2 Extend `createCursorParser` to take whether partial output is on, report each text delta through an `onPartial` callback with a stable per-message `partId`, and emit one persisted `assistant.text` carrying the whole message text and the same `partId` (the flush), never a persisted delta; set `capabilities.partialOutput: 'text'` and pin it to `RUNTIME_PARTIAL_OUTPUT['cursor']`
- [x] 2.3 Test the parser over `stream-partial-output.jsonl`: delta ordering, one persisted `assistant.text` per message with no delta persisted, the completed event superseding the partial, a cut-off stream, cancel mid-stream, and a resumed session; assert the merged transcript renders one block
- [x] 2.4 Wire the parser's partials to `sink.onPartial` in `runTurn` (the current `onLine` forwards events only)

## 3. Gemini adapter

- [x] 3.1 Extend `createGeminiParser` to report each `message` delta through an `onPartial` callback with a stable per-message `partId`, and coalesce a message's chunks into one persisted `assistant.text` carrying the whole text and the same `partId`, flushed on the next non-text event and in `finish()`; set `capabilities.partialOutput: 'text'` and pin it to `RUNTIME_PARTIAL_OUTPUT['gemini']`
- [x] 3.2 Test the parser over `streaming-deltas.jsonl`: delta ordering, coalescing to one persisted `assistant.text` per message, the completed event superseding the partial, a cut-off stream, cancel mid-stream and resume; assert the merged transcript renders one block and `finalText` is unchanged
- [x] 3.3 Wire the parser's partials to `sink.onPartial` in `runTurn`

## 4. Page coverage and redaction

- [x] 4.1 Add `cursor: 'text'` and `gemini: 'text'` to `RUNTIME_PARTIAL_OUTPUT` in `packages/shared/src/events.ts`
- [x] 4.2 Page test: the coalesced cursor and gemini text renders as one block, and a live cursor/gemini run (given partials) never renders an empty working state — the row reads as writing with elapsed time, not "whole steps only"
- [x] 4.3 Redaction test: a secret split across two gemini chunks and across two cursor deltas is never released in a `run.delta` frame (the engine `PartialBuffer`, fed the runtimes' `onPartial` output)

## 5. Render evidence and delivery

- [x] 5.1 Rendered evidence in every theme at desktop and phone width for a cursor and a gemini worker page mid-turn (streaming text and a running tool), captured from a scratch harness outside the worktree and attached to the ticket
- [x] 5.2 `pnpm lint && pnpm typecheck` green; one full test suite at a time with `--maxWorkers=4`, both suite blocks pasted in the PR; open the PR naming the real-run check the owner must still do for each runtime
