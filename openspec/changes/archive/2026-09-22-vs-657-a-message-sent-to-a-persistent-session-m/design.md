## Context

See proposal.md — Why.

Today a human message to a ticketless persistent session goes through `threads.inbound`, which stores the message and enqueues a `human_message` wake for the session's agent (`packages/core/src/threads/service.ts`). A running turn holds its claimed wake, so `wake.enqueue`'s coalescing gate cannot fold the new message into it and the message becomes a new queued wake (`packages/core/src/wake/index.ts`). The dispatcher only claims it after the running turn finalizes (`packages/core/src/runs/dispatcher.ts`). That is the queue captain could not interrupt.

The pieces needed already exist:

- `workers.message` implements exactly the desired delivery for ticket-bound workers (VS-254): a human live send on a runtime without mid-turn input cancels the running run with `runs.cancel(actor, runId, 'interrupt', 'message')` and enqueues a wake carrying the words (`packages/core/src/workers/index.ts:721`).
- Finalize already classifies that cancel as `status:'interrupted'`, `errorCode:'interrupted_by_message'`, and suppresses the session "ended without an answer" notice for it (`packages/core/src/runs/engine.ts`).
- The runtime layer already stops a turn on `cancel('interrupt')`: SIGINT to the process group with a SIGKILL backstop 30 s later, plus protocol-level interrupts for codex (app-server `turn/interrupt`) and opencode (serve `POST /session/:id/abort`) (`packages/runtime-sdk/src/process.ts`, `packages/runtimes/*`).
- A session's answer is delivered to its thread by `deliverSessionAnswer`, whose context comes from the run's `human_message` wakes (`packages/core/src/runs/engine.ts` `sessionReplyContext`).

The gap is only at the entry point: nothing inspects the active-run map for a session, and `workers.message` refuses a ticketless agent.

## Goals / Non-Goals

- **Goals**: interrupt a ticketless session's running turn on a new human message and resume on the same session; coalesce rapid messages into one resumed turn; keep the interrupted transcript visible and marked; make the composer state what a send will do; mark dictated messages at delivery without altering what was stored.
- **Non-Goals**: changing ticketed workers, interactive sessions or the weaver's delivery; changing the runtime launch mechanism; a per-user account store.

## Decisions

### Decision 1 — A session interrupts on a message even where the runtime supports mid-turn input

For a ticketless session a new human message interrupts, on every runtime, including claude and the built-in runtime that declare `streamingInput`. A mid-turn `send` injects text without stopping the turn, which is not what the ask describes ("it stops it in its tracks and then it resumes it with the new message"). Alternative considered — reuse the worker rule (mid-turn where supported, interrupt otherwise) — rejected because it would leave captain unable to stop a running claude session, the reported problem.

`describeLiveInput` (`packages/core/src/runs/active.ts`) gains the agent's kind: for a `session` with a running turn it reports `{ midTurn: false, interrupts: true }`; a worker's status is unchanged. This reuses the existing pre-send label in `WorkerPage`.

### Decision 2 — Reuse the existing interrupt mechanism, add no new one

The session path calls the same `runs.cancel(actor, runId, 'interrupt', 'message')` the worker path calls. Finalize already produces `interrupted_by_message`; the 30 s SIGKILL escalation already lives in `runtime-sdk`; codex and opencode already have protocol interrupts. No runtime adapter code changes are needed — only a test per adapter proving the interrupt path, and a statement of which runtimes are signal-only. Sessions run the same adapters workers do, so this is a coverage test, not a mechanism.

### Decision 3 — The trigger lives in `threads.inbound`, gated to a ticketless session

`threads.inbound` is the one funnel for a session conversation (web and channel). The branch that currently enqueues the `human_message` wake inspects the addressee: when its agent `kind === 'session'`, `ticketId` is null, and a run is executing for it, the daemon cancels that run before/alongside the existing enqueue. The weaver's primary thread and a planner's thread are therefore untouched (their address is not a session).

Constraint: `threads.inbound` runs its writes inside `tx()` and `packages/core/src/tickets/tx.ts` forbids awaiting inside the callback. The active-run lookup and the enqueue are synchronous; `runs.cancel` is called after the transaction returns (its first statement sets `entry.cancelled` synchronously, so a second concurrent message sees the marker before any await).

### Decision 4 — The resumed wake is a `human_message`, not a `live_interrupt`

The resumed turn's wake stays `source: 'human_message'` with its existing payload (`threadId`, `messageId`, `body`) and gains `interruptedRunId`. Reasons:

- `sessionReplyContext` reads `human_message` wakes to know which thread and which human message the answer replies to; a `live_interrupt` wake would leave the session's answer unlinked (VS-596/VS-620).
- The prompt already renders a `human_message` body under "What was said"; the message is long-form, not a bounded "why you were woken" line.

The "previous turn was interrupted" note in `buildTurnPrompt` is generalised: it fires for a `live_interrupt` wake (as today) **or** for any wake whose payload carries `interruptedRunId`, so a session's resumed turn is told its previous turn was interrupted and to verify what it had already done.

Alternative considered — a new `session_interrupt` wake source — rejected: it would duplicate the `human_message` context the answer delivery depends on and add an enum value with no other use.

### Decision 5 — Coalescing is the cancelled marker plus the existing bundle gate

A second message arriving while the first interrupt is still stopping finds the active run already carrying `cancelled.cause === 'message'`. In that case the daemon does **not** cancel again; it only enqueues, and the wake coalescing gate folds the second `human_message` into the first queued wake's `payload.bundle`. `flattenWakes` unpacks the bundle for both the prompt and `sessionReplyContext`, so both messages reach the one resumed turn in order, each exactly once.

Boundary, stated as a spec scenario: once the resumed turn has actually started, a further message is a new turn's message and interrupts that turn under the same rule. That is the correct reading of "while the turn is stopping" — the stopping window ends when the resumed turn starts.

Alternative considered — a timed debounce window — rejected as arbitrary and untestable without a clock; the cancelled-run marker is the real state.

### Decision 6 — The interrupted transcript is marked in the shared renderer

`packages/render` builds every transcript surface. Its `ToolBlock.status` gains `'interrupted'`; when the run's final status is `interrupted` or `cancelled`, any tool call still `pending` at the end is rendered as `'interrupted'` ("not completed"), distinct from `'error'` (failed) and from a live `pending`. The turn-level line for `run.finalized` already reads "run interrupted". No partial text needs persisting: the recorded events up to the cut remain the turn's transcript, and a runtime that flushed partial text into its own session (the built-in runtime) resumes with it.

Alternative considered — having the engine append synthetic `tool.result` events for unmatched calls on interrupt — rejected: the engine does not track in-flight tools per runtime, and it would hard-code a per-runtime convention the renderer can derive from the run status alone.

### Decision 7 — The dictated mark is a payload flag rendered by one shared helper

The composer sends `dictated: true`; the flag rides in the wake payload (thread message, ticket comment, decision answer) and is never written into the stored body. One exported helper next to `humanSelectionNotice` (`packages/core/src/prompts/index.ts`) returns the `(voice dictated)` line from a payload; `buildTurnPrompt` and `weave_inbox` both use it, so the two read paths cannot drift (the VS-638 pattern). For a worker message delivered into a running turn, the marker is prepended to the string handed to the runtime's `send`.

No database change: `wakeups.payload` is JSON, and the flag is not needed after delivery.

### Decision 8 — The setting is per-user, device-local

The "mark all my messages as voice dictated" toggle is stored in `localStorage` beside `conductor.dictationAutoSend` (`packages/ui/src/lib/dictationAutoSend.ts`) and read by the composers when they build a send. Rationale: dictation is a property of the person and the device they are speaking into; a workspace setting would mark every human's messages, which is the wrong scope. The ticket allows a user setting. No daemon config or migration.

### Decision 9 — Session attachments reuse the conductor chat's pipeline wholesale

A persistent session's thread is already an ordinary non-ticket-bound `channel_thread`, so `threads.inbound` already accepts attachments on it, stores them under the same type/size caps, and puts `attachmentIds` in the `human_message` wake; `weave_inbox` already turns an image's bytes into image content and a text document's into its literal content, and the session's prompt already names the attachments. Nothing server-side is needed.

The gap is the surface only:

- `WorkerPage`'s session composer passes no `allowAttachments` and drops the files argument; the V1 `Composer` already implements browse, paste, multi-file, drop and over-cap feedback behind that flag.
- `SessionThreadFeed` renders `row.message.body` with `Markdown` and no attachment rows; the shared `AttachmentRows` from `ChatMessage` is the same component the weaver chat uses.

So the change is: pass `allowAttachments`, hold the files in the page, forward them through the existing `usePostThreadMessage` multipart arm, and render `AttachmentRows` on a human message. No new storage, route, cap or validation.

Alternative considered — a session-specific attachment path — rejected: it would duplicate the caps, the serving route and the delivery, and drift from the weaver chat.

### Decision 10 — The per-runtime form of an attachment is split to a second ticket

The third ask also wants the attachment delivered "in the form each runtime accepts", naming runtimes that take images natively and giving the others a path. That is a runtime-capability question — Claude renders MCP image content; the built-in runtime only passes an image to a model whose provider profile declares image input; Codex and OpenCode need a probe — and it applies to every agent, not only sessions. Folding a per-runtime capability, a file-path fallback and a five-runtime test matrix into a change that already carries the interrupt and dictation work would make it unreviewable and delay the parts captain asked for first.

The split's exact scope is in proposal.md ("Split"). This change keeps composer parity with the weaver chat, which is what "reuse whatever the weaver chat already supports" asks for; the current runtime-neutral delivery (image bytes and text content through the inbox) is what the weaver chat has today too.

## Risks / Trade-offs

- **[A second message starts a second turn instead of coalescing]** → the cancelled-cause marker plus the wake bundle gate cover the stopping window; the boundary is explicit in the spec and covered by a test.
- **[The interrupt loses work the agent had done]** → the same runtime session resumes, so the context and any completed tool effects remain; the resumed turn is told it was interrupted and to verify before redoing; the transcript stays visible.
- **[A runtime does not stop cleanly]** → all six runtimes already stop on SIGINT with a SIGKILL backstop; codex and opencode also interrupt at the protocol level; gemini and cursor are signal-only and are named in the report rather than silently queued.
- **[Interrupting a claude/weave session is more disruptive than injecting text]** → accepted deliberately (Decision 1); it is the behaviour asked for, and it is reversible in a later change if captain prefers injection.
- **[The `tx` no-await rule is broken by adding the cancel]** → cancel is issued after the transaction commits, never inside `fn`.
- **[Session attachments reach composer parity but a runtime still cannot render the image]** → accepted and explicit: this change reuses the weaver chat's runtime-neutral delivery; the per-runtime native-image probe and the readable-path fallback are the split ticket (Decision 10), not silently dropped.

## Migration Plan

No schema or config migration. Deploy is the normal daemon upgrade; rollback is reverting the commit. Existing sessions and in-flight turns are unaffected.

## Open Questions

- **The weaver's chat still queues while a turn runs.** The ticket asks this be listed, not changed. It is a natural follow-up: the same entry point could interrupt a weaver turn, but the weaver's delivery, self-report cadence and wake semantics are out of scope here.
- **Whether sessions on a streaming-capable runtime should inject rather than interrupt.** Deferred; Decision 1 follows the ask literally.
