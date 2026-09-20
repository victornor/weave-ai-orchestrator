## Why

A running worker page sits on "working" between steps. Captain (2026-09-19) watched an opencode worker do a tool call every ~7 s and saw nothing move; in a second case, a 5-minute, 50-tool-call turn that never narrated left the page looking dead ("no response from the agent"). The worker was healthy both times. The page had nothing true to show.

Measured on real `opencode` 1.18.31 bytes (mock provider, scratch HOME; see design.md): `opencode run --format json` prints a part only when it is complete, so a tool's `tool_use` line arrives after the tool has finished (a 3 s tool was invisible for 3 s and never appeared as running), and text appears when its message ends, not as it is generated (first token at +2.2 s, visible at +4.6 s). The daemon and the browser add single-digit milliseconds; the loss is at the runtime and in a UI with no "live turn" state.

## What Changes

- **Runtime-neutral partial output.** `TurnSink` gains an optional `onPartial` for text, reasoning and tool-input deltas. The engine coalesces and broadcasts them as ephemeral `run.delta` frames on the existing workspace stream. Nothing partial is written to `run_events`: the persisted transcript stays exactly the completed events it is today, so the events table does not grow and existing readers (`weave_run_inspect`, `packages/render`, `packages/ui/src/lib/transcript.ts`) are untouched.
- **Tool start is an event.** Adapters emit `tool.call` when a tool starts, not when it finishes, so the transcript's existing `pending` block is finally visible while the tool runs.
- **opencode drives `opencode serve`** (one per turn, the same way `compact.ts` already does) and reads its `/event` stream (`message.part.delta`, `message.part.updated`, `session.status`). `run --format json` is kept only as the fallback when the server cannot start.
- **UI: a live-turn model and a live activity row** on every running run (worker page, run page, ticket feed, weaver chat): a state that is never bare "working" (streaming text, thinking N s, waiting for the model N s, running `<tool> <target>` N s, or "this runtime reports whole steps only"), turn elapsed, tool-call count, and time since the last event, plus a spinner and elapsed time on a running tool. This is what covers a long tool-only turn with no text.
- **Slices sized for the 45-minute turn limit:** (1) event model + UI + opencode, (2) claude (weaver and worker), (3) cursor and gemini; codex is a named follow-up.

## Capabilities

### New Capabilities
- `live-run-progress`: what a running run's page must show at every moment, the partial-output contract between runtimes, engine and page, and the runtime coverage.

### Modified Capabilities
- `opencode-runtime`: the turn is driven through `opencode serve`, with `run --format json` as fallback; every existing guarantee is kept.

## Impact

- `packages/runtime-sdk` (`TurnSink.onPartial`, `RuntimePartial`), `packages/shared` (`RUN_DELTA` frame shape, `RuntimeCapabilities.partialOutput`), `packages/core/src/runs` (coalescer, live snapshot, `GET /runs/:id/live`), `packages/runtimes/opencode` (serve driver), later `claude` and `cursor`/`gemini`.
- `packages/render` (live-turn model), `packages/ui` (`runStream`, `RunTranscript`, `WorkerFeed`, chat).
- `docs/API.md` (new frame and route). No migration; no new table.
