## 1. Slice 1a — event model (runtime-sdk, shared, engine)

- [x] 1.1 Add `RuntimePartial`, `TurnSink.onPartial?` and `capabilities.partialOutput` (`none | text | full`) to `packages/runtime-sdk` (omitted means `none`, so existing adapters need no change), verified by the typecheck and the engine test that drives `onPartial`
- [x] 1.2 Add the `run.delta` frame shape and the `GET /runs/:id/live` response type to `packages/shared`, and document both in `docs/API.md`
- [x] 1.3 Add the engine `PartialBuffer` (per-run, per-part accumulation, 50 ms coalescing, 64 KB cap, cleared on the completed event, turn end and cancel) wired to `onPartial`, broadcasting `run.delta` through `emitRunEvent`'s ephemeral path; verify with tests for delta ordering, coalescing (200 deltas in one second → ≤ 20 frames, zero `run_events` rows), truncation at the cap, a cut-off stream and cancel mid-stream
- [x] 1.4 Add `GET /runs/:id/live` returning the in-memory partials of a live run (none once finished), verified at the service level by the engine test (the route is a one-line pass-through)

## 2. Slice 1b — opencode server driver

- [x] 2.1 Capture the real bytes first: record `opencode serve` SSE output (permission ask, error, message tokens/cost, idle) from a scratch-HOME run against a local mock provider into `packages/runtimes/opencode/fixtures`, and note the exact route and event shapes in the design
- [x] 2.2 Implement the serve driver (start on a loopback port under containment, listen-line wait, `prompt_async`, session-filtered SSE reader, auto-approve by permission mode, abort-then-terminate cancel, resume by session id) and its event translation to `tool.call` at start, `tool.result` at completion, `assistant.text`/`assistant.thinking` with `partId`, and `onPartial` deltas; verify against the recorded fixtures and a fake server
- [x] 2.3 Keep usage and cost, `incomplete_turn` and provider-error handling on the new path and fall back to `run --format json` when the server does not start or the stream drops before the first event; verify with fake-server tests for each outcome, a cut-off stream, cancel mid-stream and resume

## 3. Slice 1c — render model and UI

- [x] 3.1 Add the pure `liveTurn(events, partials, now, capabilities)` model to `packages/render` with golden tests for each state (streaming, thinking, waiting for the model, running tool, whole-steps-only, long tool-only turn)
- [x] 3.2 Add `useLiveTurn` over `run.delta` frames and `GET /runs/:id/live` in `packages/ui/src/api`, batched per animation frame, and render the trailing partial block in the transcript
- [x] 3.3 Add the live activity row (state, elapsed seconds in that state, turn elapsed, tool count, time since last event, one-second clock, no polling) and a pulsing marker on a running tool to `WorkerFeed`, the run page and the ticket feed (the running tool's elapsed seconds are on the row); remove the empty skeleton for a live run with no events; component tests that a live run never renders an empty working state. The weaver chat is wired in slice 2, where it first has a runtime that streams
- [x] 3.4 Render evidence in every theme (dark, light) at desktop and phone width for the states in design §5 (rendered from the real components in a scratch Vite harness outside the worktree) and attach the images to the ticket

## 4. Slice 1d — measurement

- [x] 4.1 Measure token-or-tool-start → adapter output before (`opencode run --format json`) and after (serve driver) on real opencode against a local mock provider, and state the engine and page hops from their bounds (50 ms coalescing, one animation frame); the browser hop and a real-provider number are not measured and are left to the owner

Slices 2 (claude, weaver and worker, weaver chat wiring), 3 (cursor, gemini) and the codex app-server driver are the follow-up tickets VS-599 (claude), VS-600 (cursor, gemini) and VS-601 (codex), each blocked on this one; the runtime coverage table in design.md §4 is their brief.
