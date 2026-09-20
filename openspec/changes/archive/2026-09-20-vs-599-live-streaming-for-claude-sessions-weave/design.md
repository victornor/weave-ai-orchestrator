## Context

See `proposal.md` — Why. Slice 1 (VS-595) landed the runtime-neutral model this change reuses and does not fork: `TurnSink.onPartial`, `RuntimePartial`, the engine `PartialBuffer` (`packages/core/src/runs/partials.ts`), the ephemeral `run.delta` frame, `GET /runs/:id/live`, the `liveTurn` render model (`packages/render/src/liveTurn.ts`), `LiveActivity` / `LivePartials`, and `useRunEventStream` (`packages/ui/src/api/runStream.ts`) which already collects partials and drops superseded ones. Everything below builds on those; nothing in the engine, shared frame, render model or the stream hook needs to change.

The Claude protocol was captured on 2026-09-20 by the weaver from a real run (`claude -p --output-format stream-json --verbose --include-partial-messages --no-session-persistence --tools "" --model haiku`, Claude Code 2.1.274). That capture is the byte-level source for this design; see Decision 4 for why no ticket turn runs the CLI to reproduce it.

## Goals / Non-Goals

- **Goals:** a Claude turn's text, thinking and tool input visible while generated; a tool visible while it runs; the weaver chat showing all of it through the same model as a worker page; persisted events byte-identical to today's for the same turn.
- **Non-goals:** changing how a weaver reply is delivered (`weave_human_send` is untouched); persisting any delta; changing the `run.delta` frame, `GET /runs/:id/live`, the engine buffer, `liveTurn`, or `useRunEventStream`; cursor/gemini (VS-600) and codex (VS-601).

## 1. Captured protocol (source of the translation)

`--include-partial-messages` adds `{"type":"stream_event","event":{…},"session_id":…,"parent_tool_use_id":…,"uuid":…}` lines to the existing `stream-json` output. In order, one message with thinking then text:

| `event.type` | payload used |
|---|---|
| `message_start` | `message.id`, `message.model` |
| `content_block_start` index 0 | `content_block.type: "thinking"`, `thinking: ""` |
| `content_block_delta` index 0 | `delta.type: "thinking_delta"`, `thinking` |
| `content_block_delta` index 0 | `delta.type: "signature_delta"`, `signature` — **never surfaced** |
| `assistant` whole line | the completed thinking block (as today) |
| `content_block_stop` 0 | — |
| `content_block_start` index 1 | `content_block.type: "text"`, `text: ""` |
| `content_block_delta` index 1 | `delta.type: "text_delta"`, `text` |
| `assistant` whole line | the completed text block (as today) |
| `content_block_stop` 1 | — |
| `message_delta` / `message_stop` | `stop_reason`, `usage` |
| `result` whole line | as today |

A tool-use block is `content_block_start` `{type:"tool_use", id, name, input:{}}`, then `input_json_delta` fragments, then the whole `assistant` line whose tool_use block carries the assembled `input`. The whole `assistant` lines arrive between the deltas for their block, which is why the completed path must not also consume deltas (proposal, "What Changes").

## 2. Decision — `partId` is `message id : block index`

- The completed events are still produced only by the existing `assistant` / `user` / `result` handling. `assistant()` gains a content index and stamps each emitted `assistant.text`, `assistant.thinking` and `tool.call` with `partId = ${message.id}:${index}`; `createClaudeParser` returns it so the adapter does not compute ids itself.
- The streaming path tracks the current message id from `message_start` and the current block index from `content_block_start`, and reports partials under the same `partId`. The message id is the one field both the delta stream and the completed line carry, so the two channels agree without any shared mutable ordering assumption.
- The engine already calls `partials.complete(payload.partId)` for a completed `assistant.text` / `assistant.thinking` / `tool.call` (`engine.ts:304`), so a partial disappears exactly when its completed event is recorded. If `message_start` was missed, the partial falls back to its `stream_event.uuid` and the completed event's `partId` will not match — the partial is then cleared by the same end-of-turn `partials.clear()` that covers a cut-off stream. This is the same bounded behaviour VS-595 defined and is not a new failure mode.
- **Alternative rejected:** a monotonic counter shared between the two paths. It would require the delta path to mutate parser state that the completed path reads in a different order across concurrent sub-agent messages (`parent_tool_use_id`), and the message-id+index pair is already unique per part.

## 3. Decision — `tool.call` is emitted once, when its input is complete

The ticket asks to "emit `tool.call` at `content_block_start`". This design emits the persisted `tool.call` at the whole `assistant` line instead, and says why, because emitting it at `content_block_start` would actively break two existing mechanisms:

- The engine's supersession keys on `partId` (`partials.complete`). An early `tool.call` carrying the same `partId` would clear the tool-input partial at its start, before any `input_json_delta` has streamed — the partial could never be shown.
- `runEventsToTranscript` pushes a new `ToolBlock` for every `tool.call` and keys the pending map by tool id (`transcript.ts:175-187`). A second `tool.call` for the same tool id would render a second, duplicate row rather than update the first.

Emitting it once at the completed `assistant` line is also faithful to "a tool shows as running when it starts": Claude's CLI begins executing a tool after that line, not at `content_block_start` (which is mid-generation, before the arguments exist). The running window the user sees — `tool.call` to `tool.result` — is the tool's real execution, and it can be seconds or minutes long, which is the window that matters. `content_block_start` for `tool_use` is still consumed, to bind the block index to the tool id so `input_json_delta` fragments can be reported under the right `partId` and `toolCallId`.

- **Alternative rejected:** emit `tool.call` at `content_block_start` with the empty input and never re-emit. The persisted tool row would lose its command or file path (`toolTarget` reads `input`), regressing the run page, the worker activity row and `weave_run_inspect`.

## 4. Decision — fixtures come from the captured protocol, not a live CLI run

The ticket says the recording may run `claude` for a tiny prompt. This ticket's host rules forbid launching the real Claude CLI from inside a ticket: the daemon shares the owner's OAuth login and rotates the refresh token on use, which has signed every agent out before (see `AGENTS.md`, 2026-09-07). The adapter's tests are therefore driven by the 2026-09-20 captured protocol above, transcribed into JSONL fixtures, plus the existing completed-line fixtures (`turn-simple.jsonl`, `turn-tool-structured.jsonl`), and by an extended fake CLI (`test/fakeCli.ts`) that emits `stream_event` lines. Fixtures:

- `fixtures/stream-events-text.jsonl` — thinking then text, matching the captured order (including the `signature_delta` and the whole `assistant` lines between deltas).
- `fixtures/stream-events-tool.jsonl` — a tool-use block with `input_json_delta` fragments and the completed `assistant` line, followed by the `user` tool_result line.

Fixtures are transcribed, not captured by this ticket: they reproduce the documented shape but are not proof against 2.1.274. The PR states the real-CLI check is left to the owner, exactly as VS-595's design did for opencode's codex/runtime table. This is the same rule that keeps the credential intact, and it is surfaced on the ticket, not absorbed silently.

## 5. Decision — the weaver chat reuses the run surface verbatim

`ChatConversation` already calls `useRunEventStream(runId, …)` and discards `partials` / `lastPartialAt` / `partialSince`; its `LiveSection` renders a bare `working` label and the pulse dot. The change:

- `ChatConversationProps` gains an optional `runtimeId`; `LiveSection` receives the stream's partials and timestamps, renders `LiveActivity` and `LivePartials` (the same components a worker page uses) in place of the `working` line, and keeps the existing compaction row and dropped-stream notice above/below them.
- `ChatPage` passes the weaver's runtime id (`weaver.data?.agent.runtimeId`); `PlanTab` passes the planner's. The run's own id is what makes the row correct if a message and a reply race.
- Nothing else about delivery changes. Partials are ephemeral (`EPHEMERAL_EVENT_TYPES`), never stored and never turned into a thread message, so `weave_human_send` remains the only way the weaver's words reach a human. A test asserts a `run.delta` frame with text creates no `ChatMessage` and no thread row.

## 6. Decision — before/after is measured against the fake CLI

The real-CLI timing ("token → visible on the page for a real Claude run (haiku)") cannot be measured here for the reason in Decision 4. The measurement task records the fake-CLI number at both the adapter (`onPartial` call → ParserOutput) and the page (`run.delta` frame → `LivePartials` rendered) hops, and states plainly that the provider-side and real-CLI numbers are left to the owner. This is the honest version of the ticket's ask; the alternative is a number from a forbidden run.

## 7. Risks / Trade-offs

- **Real protocol drift from the transcript fixtures** → the design table names the exact event shapes; a shape mismatch in the real CLI degrades to "no partials for that block" (the completed path is untouched), never to a broken turn. The owner's first real run is the check.
- **`--include-partial-messages` raises stdout volume** (one line per delta) → `onRaw` is a no-op in the engine (`engine.ts:612`) and only the adapter reads stdout; no event row or log file grows from a delta.
- **Sub-agent streaming (`parent_tool_use_id`)** → partials are keyed by the sub-agent message's own id, so a sub-agent's block cannot supersede the main message's partial; each is cleared by its own completed event or the turn end.
- **A signature leaking** → `signature_delta` is consumed with no output; a parser test asserts the value never appears in emitted events or partials.
- **The chat rendering the weaver's draft as if sent** → guarded by the no-thread-message test and the existing `weave_human_send`-only delivery; the run view is the only place partials appear.

## Open Questions

None that change the specs, approach or tasks. The owner's real-CLI confirmation is a stated external check, not a blocked decision.
