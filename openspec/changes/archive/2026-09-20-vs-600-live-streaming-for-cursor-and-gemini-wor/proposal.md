## Why

Slice 3 of captain's live-UX ask, after VS-595 slice 1 (the runtime-neutral `onPartial` model, `run.delta` frames, the live-turn model and the live activity row, opencode wired). A cursor or gemini worker page has the live row and the throttled partial channel already; neither adapter feeds it, so both still read as "whole steps only" and their assistant text appears only when a step ends.

The two runtimes differ in how far they already go. `cursor-agent --stream-partial-output` (present in the installed 2026.09.10 bundle help, "only works with --print and stream-json format") emits one `assistant` event per text delta, plus a whole-text `assistant` event before each tool call and at turn end. Gemini's `message` events already carry `delta: true` for every assistant chunk (installed 0.60.0 bundle, `stream-json` emit sites), so today the adapter persists one `run_events` row per chunk and the transcript merges them at render time — correct on screen, but token-proportional events-table growth. Both need only an adapter change: feed the deltas to `onPartial`, coalesce before storing, and declare `partialOutput: 'text'`.

## What Changes

- **Cursor:** `buildArgs` adds `--stream-partial-output` (valid only with `--print --output-format stream-json`, which the adapter already uses). The parser feeds each text delta to `TurnSink.onPartial` with a stable `partId` per assistant message and emits exactly one persisted `assistant.text` per message carrying that `partId`, so the completed event supersedes the partial and the transcript shows one block. `capabilities.partialOutput` becomes `'text'`.
- **Gemini:** the parser feeds each `message` delta to `onPartial` and coalesces the chunks into one persisted `assistant.text` per assistant message (full text, same `partId`), flushed when the next non-text event arrives and at process end; no per-chunk `run_events` rows. `capabilities.partialOutput` becomes `'text'`.
- **Page coverage:** `RUNTIME_PARTIAL_OUTPUT` in `packages/shared` gains `cursor: 'text'` and `gemini: 'text'`, so the live activity row reads "Writing" instead of "whole steps only" for both. The running-tool row already works for both (cursor emits `tool.call` on `tool_call/started`; gemini on `tool_use`); no change needed there.
- **Redaction:** unchanged — the engine's `PartialBuffer` already redacts partials exactly as it redacts persisted event text; a test pins it for these runtimes' partials.
- No schema, migration or route change: the model, frames and page were delivered by VS-595.

## Capabilities

### New Capabilities
- `gemini-runtime/adapter`: gemini as a local coding-CLI runtime, in particular its partial-output behavior.

### Modified Capabilities
- `cursor-runtime/adapter`: a cursor turn streams assistant text as it is generated.
- `live-run-progress`: runtime coverage now names cursor and gemini as text-streaming runtimes.

## Impact

- `packages/runtimes/cursor` (`args.ts`, `events.ts`, `adapter.ts`, fixtures, tests), `packages/runtimes/gemini` (`events.ts`, `adapter.ts`, fixtures, tests).
- `packages/shared/src/events.ts` (`RUNTIME_PARTIAL_OUTPUT`), `packages/render`/`packages/ui` tests only (the page already renders partials and coalesces adjacent `assistant.text`).
- `docs/API.md` unchanged (no new frame or route).
