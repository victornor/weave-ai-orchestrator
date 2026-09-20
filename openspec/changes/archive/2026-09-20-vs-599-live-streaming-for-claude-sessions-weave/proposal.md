## Why

Slice 1 (VS-595) built the runtime-neutral partial-output model and wired opencode, but the weaver chat and every Claude worker still sit on a bare "working" between steps: the chat renders the literal word `working` with a pulsing dot and never asks for partials, and the Claude adapter never emits any (`packages/runtimes/claude/src/args.ts` has no `--include-partial-messages`). Claude is the runtime the conductor and most workers actually run on, so the live experience captain asked for ("smoother, more live, more interactive") is still missing where it is seen most.

## What Changes

- **Claude streams.** `buildArgs` adds `--include-partial-messages` to both the headless (`--input-format text`) and live-input (`--input-format stream-json`) forms; the adapter declares `capabilities.partialOutput: 'full'`.
- **`stream_event` translation.** The parser consumes Claude's `stream_event` lines (`content_block_start`/`content_block_delta`/`content_block_stop`/`message_*`) into `onPartial` for text (`text_delta`), thinking (`thinking_delta`) and tool input (`input_json_delta`), ignores `signature_delta`, and attaches the same `partId` to the partial and its completed `assistant.text` / `assistant.thinking` / `tool.call` event so the engine drops the partial when the completed event lands. `stream_event` lines no longer become persisted `runtime.raw` events.
- **Tool start is visible.** A tool reads as running from the moment Claude's tool call is fully specified (the completed `assistant` line, immediately before the CLI executes it) until its `tool.result`, exactly as opencode's serve path does. The persisted `assistant.text`/`assistant.thinking`/`tool.call`/`tool.result` events stay as they are today — no delta is ever persisted.
- **Weaver chat goes live.** The chat's live section renders the same `LiveActivity` row and trailing partial text as a worker page (through the existing `useRunEventStream` / `liveTurn` model), instead of the bare `working` line, and the runtime id is plumbed to it so it can say "whole steps only" for a runtime that cannot stream.
- **Declared coverage.** `RUNTIME_PARTIAL_OUTPUT` gains `claude: 'full'` so the page treats a Claude run as streaming.

## Capabilities

### New Capabilities
- `claude-runtime`: the Claude adapter's partial-output contract — how `--include-partial-messages` `stream_event` lines become partial text, thinking and tool input, what is never surfaced (signatures), and how a completed event supersedes its partial.

### Modified Capabilities
- `live-run-progress`: the runtime-coverage declaration now includes Claude, and the weaver chat is required to render the same live activity row and partial text as any other run surface, with nothing streamed able to reach the human channel before the weaver sends it.

## Impact

- `packages/runtimes/claude`: `src/args.ts` (flag), `src/events.ts` (stream_event translation, `takePartials`), `src/adapter.ts` (`onPartial` wiring, `partialOutput`), `fixtures/` (recorded partial + tool-using streams), `test/` (parser, adapter, live-input).
- `packages/shared/src/events.ts`: `RUNTIME_PARTIAL_OUTPUT.claude`.
- `packages/ui`: `v2/ChatConversation.tsx` (live section uses `LiveActivity` + `LivePartials`), `v2/ChatPage.tsx` / `v2/PlanTab.tsx` (runtime id), component tests.
- No new route, frame or migration: the `run.delta` frame, `GET /runs/:id/live` and the engine `PartialBuffer` from VS-595 are reused unchanged; no API doc change.
