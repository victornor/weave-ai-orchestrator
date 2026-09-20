## Context

Captain's bar: a running worker page should feel like using the adapter directly, for every runtime and for the weaver chat. This document is the diagnosis, the measured numbers, the one design decision that is costly to undo (how opencode is driven), the runtime-neutral partial model, and the slicing.

## 1. Diagnosis — where the latency is lost

**Method.** Real `opencode` 1.18.31 output against a local mock OpenAI-compatible provider (scratch `HOME`/`XDG_*`, no credentials, no live CLI login): first token after 1.5 s, four text chunks 200 ms apart, then a `bash` tool call (`sleep 3; ls`). This reproduces the shape of a real step without touching the owner's credentials. Timings are wall-clock offsets from prompt submission; the mock's own log gives the ground truth of when each token was produced. The provider-side latency of `deepseek-v4.1-flash` is not measured here (live provider, forbidden); the layers below are independent of it.

### Runtime — `opencode run --format json` (what the adapter uses today)

| Moment | Ground truth | On stdout | Lost |
|---|---|---|---|
| step starts | +0.9 s | `step_start` at +2.4 s (after the first token) | 1.5 s |
| text streaming | tokens at +2.2 … +3.4 s | `text` at +4.6 s (one line, whole text, when the text part closes) | 2.4 s from first token |
| tool starts | +4.9 s | nothing | — |
| tool completes | +7.5 s | `tool_use` (state `completed`) and `step_finish` at +7.57 s, the same millisecond | 3 s of a running tool invisible |

The serializer prints completed parts only; `tool_use` carries a `completed` state, never `running`. The adapter therefore emits `tool.call` and `tool.result` within the same millisecond, so the transcript's `pending` tool block is never visible for opencode. `run --port N` does not open a server either (probed: `/global/health` never answered while the run was live), so there is no side channel on `run`.

### Runtime — `opencode serve` event stream (`GET /event`, SSE)

Same scenario, prompt sent with `POST /session/:id/prompt_async`:

| Moment | Ground truth | SSE |
|---|---|---|
| text tokens | +1.96, +2.36, +2.77, +3.17 s | `message.part.delta` at +1.97, +2.37, +2.77, +3.17 s (2–9 ms after the token) |
| tool starts | ≈ +4.07 s | `message.part.updated` `state.status: "running"` at +4.08 s |
| tool completes | ≈ +7.1 s | `message.part.updated` completed with `metadata.output`, `time.start/end` |

So the stream carries deltas within ~10 ms and a running tool at start. Events also include ~50 `plugin.added` and `catalog.updated` frames at startup and `session.updated`/`session.diff` noise: the driver filters by `sessionID` and by type.

### Daemon

`engine.record()` runs per event: one SQLite `INSERT`, one `UPDATE runs`, one `appendFileSync`, then `emitRunEvent` → `ctx.events.broadcast('run.event', …)` (already ephemeral, no outbox row, VS-417). It is synchronous and sub-millisecond per event; it adds no perceptible delay and pushes each event the moment the adapter hands it over. The daemon is not the problem, and there is no polling to remove. What it lacks is any path for a non-persisted event, which is why deltas cannot be pushed today.

### Page

`useRunEventStream` appends each `run.event` frame immediately, and `runEventsToTranscript` turns `tool.call` without a result into a `pending` block, so the page already shows a running tool **if the adapter emits `tool.call` at start**. The gaps are in the page itself: (a) with `events.length === 0` it shows skeleton rows; (b) there is no live state between events, so a run waiting on the model shows nothing (the reported "sitting on working"); (c) a `pending` tool has no spinner and no elapsed time; (d) no turn elapsed, tool count or time-since-last-event. Cost per event: the whole transcript is rebuilt from the full array on each frame (O(n)). That is fine at completed-event rates (~1 event/s) but not at delta rates, which is why deltas do not go through that path (Decision 3).

**Conclusion:** latency is lost (1) in the adapter's choice of `run --format json`, for opencode, and (2) in the absence of a live-turn model in the page, for every runtime. The daemon-to-browser hop is not a contributor (≪ 10 ms). Slice 1 re-measures end to end after the change (task 4.1).

## 2. Decision — how opencode is driven

| | A. `opencode serve` per turn + SSE (chosen) | B. keep `run --format json` | C. `run --attach <url>` | D. `run --port` |
|---|---|---|---|---|
| partial text/reasoning | yes (`message.part.delta`) | no | no — same serializer | no server |
| tool running state | yes | no | no | no |
| lifecycle | adapter owns a server process; must start, wait for listen line, stop | one process | needs a server anyway | measured dead |
| MCP config per run | `.opencode/opencode.json` in cwd, rewritten before each turn as today; server started with the same cwd reads it | same | same | — |
| permissions | server asks over `permission.asked`; adapter answers `POST /session/:id/permissions/:permissionID` `once` when mode is `auto`/`bypass` and rejects for `restricted` (replacing `--auto`) | `--auto` | — | — |
| resume | same session id; `POST /session/:id/prompt_async` on an existing session | `-s <id>` | — | — |
| cancel | `POST /session/:id/abort`, then terminate the server by its recorded pid | kill process | — | — |
| compaction, cost/usage | `message.updated` info carries tokens and cost; compaction already uses `serve` (`compact.ts`) | `step_finish` tokens | — | — |
| errors, `incomplete_turn` (VS-573) | `session.error` and `message.updated` `error`; a turn that ends `session.status: idle` after a `tool-calls` finish is incomplete; provider-log read (VS-461) kept | as today | — | — |

**Choice: A, with B as automatic per-turn fallback** when the server does not report a listen line within 10 s or the event stream drops before the first event. Reasons: A is the only option that yields deltas and running tools (C and D measured/read as inferior); it reuses a pattern the adapter already ships (`compact.ts`); B is retained verbatim, so the risk of A is bounded to "no partials" rather than "no turn". The costly-to-undo part is the driver boundary, not the wire format: the engine only sees `onEvent` and `onPartial`, so replacing the driver later changes nothing above the adapter. The parser for `run --format json` stays; the server driver is a second producer of the same `RuntimeEvent`s.

Open verification the apply phase must do with a fake server (not the real CLI): exact `permission.asked` shape and reply route, `session.error` shape, message-level `tokens`/`cost` fields, and `session.status` idle as end-of-turn. The route names above are read from the running server's own responses in the diagnosis; anything not seen there is captured first, before its parser is written.

## 3. Decision — runtime-neutral partial model

```ts
// runtime-sdk
interface RuntimePartial {
  kind: 'text' | 'thinking' | 'tool_input';
  partId: string;      // stable per part; the completed event carries the same id
  messageId?: string;
  text: string;        // the appended delta, not the whole text
  toolCallId?: string; // for tool_input
}
interface TurnSink { …; onPartial?(p: RuntimePartial): void }
capabilities.partialOutput: 'none' | 'text' | 'full'
```

- **Ephemeral, never stored.** Alternative rejected: persisting deltas as events. It would multiply `run_events` rows by the tokens-per-message (hundreds per message vs ~1/s today), grow the events file, and change what `weave_run_inspect` and every renderer sees. Instead the engine's `PartialBuffer` per run accumulates text per `partId`, and a 50 ms timer emits one `run.delta` frame `{ runId, partId, kind, text (appended since last frame), offset }` on the existing workspace stream. Write rate: 0 DB rows; ≤ 20 frames/s per run, each ≤ 4 KB; the buffer is capped at 64 KB per part and dropped when the completed event with the same `partId` is recorded, on turn end, and on cancel.
- **Completed event supersedes.** Adapters put `partId` in the payload of the completed `assistant.text` / `assistant.thinking` / `tool.call`. The page drops the partial for a `partId` once the completed event is present (idempotent, so ordering across the two channels does not matter).
- **Reconnect.** `GET /runs/:id/live` returns `{ partials: [{ partId, kind, text }] }` from the in-memory buffer. A page reads it once after connecting or reconnecting, then applies frames whose `offset` extends what it holds (a gap triggers one re-read). No polling.
- **Weaver chat and every run surface** use one hook, `useLiveTurn(runId)`, over the same frames; the chat's dead `partial` path was removed in VS-9 and is not revived.
- **Render model.** `packages/render` gets a pure `liveTurn(events, partials, now, capabilities)` returning `{ state, label, sinceMs, turnMs, toolCount, sinceLastEventMs }`, unit-tested, used by web and TUI. The transcript itself is rebuilt only from persisted events as today; partial text is appended as a trailing block, so the O(n) rebuild does not run per delta and frame application is batched per animation frame.

## 4. Runtime coverage (verified against installed binaries, help output and generated schemas, 2026-09-19; no runtime was run against live credentials)

| Runtime (installed) | Mode used today | Partial output available | Flag / protocol | Slice |
|---|---|---|---|---|
| opencode 1.18.31 | `run --format json` | full: text and reasoning deltas, running tool with input | `serve` + SSE `/event` (measured above) | 1 |
| claude 2.1.274 | `-p --output-format stream-json --verbose` | text, thinking and tool-input deltas as `stream_event` lines | `--include-partial-messages` (present in `claude --help`, "only works with --print and --output-format=stream-json"); event shapes to be captured from a fake CLI recorded from the documented protocol, then checked by the owner once against a real run | 2 (weaver and worker) |
| cursor-agent 2026.09.10 | `-p --output-format stream-json` | text deltas | `--stream-partial-output` (present in help, "only with --print and stream-json") | 3 |
| gemini 0.60.0 | `-o stream-json` | text: `message` events already carry `delta: true` (`gemini/src/events.ts:46`) | none needed; check that the page coalesces them rather than printing each as a block | 3 |
| codex 0.154.0 | `exec --json` | `exec --json` emits only `item.started/completed`; deltas exist only in the `app-server` protocol (`item/agentMessage/delta`, `item/reasoning/textDelta`, `item/commandExecution/outputDelta`, `item/mcpToolCall/progress`, found in the generated schema) | would mean driving `codex app-server` for turns (as `codex/src/compact.ts` already does for compaction): a full driver rewrite with its own approval and resume semantics | follow-up ticket; shows "whole steps only" meanwhile |

Follow-up tickets, each blocked on VS-595: VS-599 (claude, weaver chat and workers), VS-600 (cursor and gemini), VS-601 (codex app-server turn driver).

## 5. UI acceptance

The live activity row and the running-tool row, in every theme, at desktop and phone width, captured for: mid-step "waiting for the model N s"; streaming text; a running tool with spinner and elapsed; a completed step; a long tool-only turn with no text (50 calls, count, elapsed, time since last event); and a whole-steps-only runtime. Captures are attached to the ticket from outside the worktree.

## 6. Risks

- **Permission auto-approve moves into the adapter** (with `serve`, `--auto` no longer exists). Mitigation: `restricted` keeps rejecting; a test drives the fake server through an ask in each mode; fallback to `run` keeps `--auto`.
- **One server per turn is start-up cost** (measured: `run` and `serve` both take ~0.5–1 s to bootstrap; not additive because `run` boots the same instance in-process).
- **Stuck-detection (VS-461 `last_progress_at`)**: partials are not events and do not reset it; only persisted progress events do. Unchanged.
- **Real-provider latency is unmeasured here.** The "after" number in slice 1 is measured on the same mock (token → visible on page). The owner can repeat it against a real provider; the plan says so and does not claim it.
