## Context

See `proposal.md` — Why. The parts of the existing system this design leans on, all verified in the tree:

- The run engine records a normalized `RunEvent` for every runtime event (`packages/core/src/runs/engine.ts:129` `record`, wired at `:243` `onEvent`). Each event is persisted to `run_events`, appended to the run's jsonl log, and pushed to a per-workspace in-process emitter (`packages/core/src/runs/active.ts` `emitRunEvent`).
- The Claude adapter's stream parser emits one `assistant.text` per text block and `tool.call` / `tool.result` pairs per tool, line by line off `claude -p --output-format stream-json` (`packages/runtimes/claude/src/events.ts`). Streaming is genuinely incremental at the daemon; the other three adapters have the same event vocabulary.
- `GET /api/w/:ws/runs/:id/events` (paged, `?after=`) and `GET /api/w/:ws/runs/:id/events/stream` (replay-then-tail SSE, `id: <seq>` frames, `Last-Event-ID` resume) already exist at `packages/server/src/routes/runs.ts:20` and `:26`.
- `conductor attach conductor` already consumes exactly that pair — resolve the agent's run, fetch persisted events, subscribe to the stream, render `runEventsToTranscript` (`packages/tui/src/apps/Attach.tsx`). This design is that pattern applied to the two chat surfaces.
- The conductor's reply reaches the human only through the `ac_human_send` tool, which writes an outbound `thread.message` (`packages/server/src/tools.ts:420`). Assistant text is never delivered as a reply — it is the run summary. So streamed assistant text and the final reply are structurally different things and cannot collide.

Two things that look like the feature but are not:

- `ChatRoute` keeps a `streaming` string fed by `thread.message` frames with `partial: true` (`packages/ui/src/routes/Chat.tsx`). Nothing in the daemon has ever set `partial`; a repo-wide search for it finds only zod `.partial()` calls. It is dead.
- `run.event` is a declared workspace event type consumed by `WorkerPage`, but no code path emits it. Also dead.

## Goals / Non-Goals

**Goals**

- Satisfy the capability in `specs/conductor-chat/live-turn-stream/` on both chat surfaces with no change to the run engine, the runtime adapters, the event bus, or the schema.
- Keep the live view derived from durable run events, so resumption after a reload is a replay rather than a special case.
- Leave one honest source of truth per surface for turning run events into blocks.

**Non-Goals**

- No new event type and no new persistence. Everything needed is already recorded.
- No shared component between the web and terminal surfaces; they keep their own renderers (see Decision 3).
- No change to how the conductor replies.

## Decisions

### 1. Subscribe to the per-run SSE stream, not to a new workspace event

The chat opens `GET /runs/:id/events/stream` for the conductor's active run, in addition to the workspace event stream it already holds.

*Alternative considered: emit `run.event` onto the workspace bus* — this would revive `WorkerPage`'s existing listener and need only one client connection. Rejected: `EventBus.emit` writes a row to the `events` outbox per event (`packages/core/src/events.ts`), so every assistant text block and every tool call of every agent would become a durable workspace event fanned out to every connected client. A busy worker turn produces hundreds. That is a large, permanent cost in storage and bandwidth for a view that only ever wants one run at a time. Scoping the fan-out to conductor runs only would work but bakes an agent-kind special case into the engine.

*Alternative considered: poll `GET /runs/:id/events?after=`* — simpler, but a poll interval fast enough to feel live is wasteful and a slow one fails the "within a second or two" requirement.

Cost of the chosen approach: a second `EventSource` from the browser while a turn runs. Two concurrent connections are far below the per-origin cap, and the stream is closed as soon as the run finishes.

### 2. Discover the run from the conductor detail, and switch runs from `run.started`

The surface needs the conductor's current run id at two moments: on load (for the reload-resume requirement) and when a new turn begins.

- On load: `GET /conductor` returns `{ worker, ticket, lastRun, usage }`, mirroring `GET /workers/:id` (`packages/server/src/routes/workers.ts:17`). Today it returns a bare `Agent`, so a client must make a second `GET /runs?agent=…` call to find the run — which is exactly the fallback the TUI `Attach` app already carries. Making the two endpoints symmetric removes that fallback and gives the chat what it needs in one request.
- Mid-session: the `run.started` workspace event carries `agentId` (`engine.ts:149`), and the chat already holds the workspace stream. When `agentId` matches the conductor, the chat switches to that run; `run.finished` clears it.

The envelope keys the agent as `worker`, exactly as `/workers/:id` does. This is a **breaking** shape change for any consumer reading agent fields off the response root, and the two first-party consumers differ:

- The web is safe. `workerDetail` (`packages/ui/src/api/hooks.ts:54`) reads `r['agent'] ?? r['worker'] ?? (r['id'] ? r : null)`, so the `worker` branch picks the agent up unchanged.
- The TUI `Attach` app is **not** safe and must be fixed in this change. It calls `unwrap<Agent>(payload, 'agent')` (`packages/tui/src/client.ts:31`), which returns the whole payload when the requested key is absent — so it would treat the envelope itself as the agent and render an empty name and status. Note this is already how `Attach` misbehaves against `GET /workers/:id`, which has returned a `worker`-keyed envelope all along; the fix (unwrap `worker` as well as `agent`) repairs both paths.

Server tests pin the envelope shape.

*Alternative considered: leave `/conductor` alone and have the web chat do the second `/runs?agent=` call.* Rejected: it keeps two endpoints asymmetric and duplicates the fallback into a third place, to save one small route change.

### 3. Each surface keeps its own transcript builder; fix the web one

The terminal renders `runEventsToTranscript` from `@agent-conductor/render`, which correlates a `tool.result` to its `tool.call` across `callId | id | toolCallId | toolUseId` and folds the result's `content` into the block. The web has its own `packages/ui/src/lib/transcript.ts`, which correlates on `callId` only and never reads the result content.

The adapters emit `id` (Claude: `{ id, name, input }` then `{ id, name, isError, content }`). So on the web every tool currently renders as a permanently pending call with no result — which is why the corrected correlation is a task here and not a drive-by: the spec's tool-block scenarios cannot pass without it.

*Alternative considered: make the web depend on `@agent-conductor/render` and delete its duplicate.* Tempting, and no boundary rule forbids it (`scripts/guard-boundaries.mjs` constrains `core`, `shared` and the SDKs only). Rejected for this change: it pulls a package built for Node/Ink rendering into the PWA bundle and turns a contained fix into a cross-package refactor with its own review surface. Worth its own ticket; noted, not taken.

### 4. Suppress the reply-delivery tool with one shared predicate

`ac_human_send` is how the reply reaches the thread. Showing its `tool.call` in the transcript would put the reply text on screen twice — once as a tool argument, once as the message. Both surfaces drop those events before building blocks, using a single predicate exported from `@agent-conductor/shared` (which both `ui` and `tui` already depend on) so the rule cannot drift between them. Suppression happens at the event level in the chat, not inside either transcript builder — `attach` and the run page should still show the call.

### 5. The live transcript is transient; the thread is durable

While a run is active the chat renders `[persisted events] ++ [streamed events]`, de-duplicated by event id. When the run finishes, the transcript is dropped and the thread's messages stand alone. This is what makes "exactly once" true by construction rather than by reconciliation: the two regions never hold the same content, because assistant text is never a reply and reply text is never a run event once `ac_human_send` is filtered.

### 6. Resumption uses the stream's existing cursor

The stream replays from `?after=<seq>` and frames carry `id: <seq>`, so reconnection is the endpoint's existing contract. The client tracks the highest `seq` it has rendered and reconnects with it; de-duplication by event id covers the overlap at the seam.

## Risks / Trade-offs

- **A second SSE connection per open chat** → Opened only while a conductor run is active and closed on `run.finished`; the daemon already serves an unbounded number of these for `attach`.
- **A long turn accumulates many events in the client** → The initial fetch is capped (the existing `limit`, max 2000) and the transcript is discarded when the run ends, so growth is bounded by one turn.
- **Changing `GET /conductor`'s shape breaks an unknown third-party consumer** → It is a loopback/daemon API with two first-party consumers, both of which already accept the envelope; the change is called out as BREAKING in the proposal and pinned by a route test.
- **Tool arguments can contain secrets** → Run events are already redacted at record time by the engine's redactor (`engine.ts:132`), and `@agent-conductor/render` redacts again. The web builder must not widen what it displays beyond what the redacted payload already carries; the corrected correlation surfaces `content`, which is truncated by the adapter (`truncate` in the Claude parser) and redacted by the engine.
- **The web's corrected correlation could change the run page and worker page too** → Same file, deliberately: those views are broken in the same way and the fix is the same. It makes existing tool blocks resolve instead of hanging; it does not add new content types.

## Migration Plan

No data migration. The only compatibility surface is `GET /conductor`'s response shape, deployed with the daemon and consumed by clients shipped from the same release. Rollback is reverting the release; nothing persists that an older build cannot read.

## Open Questions

None. The two judgement calls that could have become questions — per-run SSE versus workspace fan-out, and fixing the web transcript builder versus adopting `@agent-conductor/render` — are settled above with their rationale.
