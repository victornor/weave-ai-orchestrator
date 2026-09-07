## Context

See `proposal.md` — Why. This section records the transport investigation the ticket asked for
before anything else, because every decision below rests on it.

### What the Claude Code CLI actually accepts (evidence)

Read out of the installed binary's own strings — `/home/user/.local/share/mise/installs/claude/latest/
claude`, read as a file, never executed (the runtime-credential rule forbids launching it):

| Fact | The CLI's own words |
|---|---|
| Realtime input exists | `--input-format <format>` — *"Input format (only works with --print): \"text\" (default), or \"stream-json\" (realtime streaming input)"* |
| It needs the other two flags | *"Error: --input-format=stream-json requires output-format=stream-json."* · *"Error: --input-format=stream-json requires --print."* |
| stdin must stay open | *"cannot read --input-format=stream-json messages from stdin (…): stdin is unreadable. stream-json input requires a readable stdin for the lifetime of the session."* |
| Frames are newline-delimited JSON, typed | accepted: `user`, `assistant`, `system`, `control_request`, `control_cancel_request`, `control_response`, `bash_command`, `queued_notification`, `session_notice`, `workflow_launch`, `keep_alive`, `update_environment_variables`; anything else → *"Ignoring unknown message type"* |
| A user frame is validated | *"Error: Expected message role 'user', got '…'"*, and a malformed one is dropped with `cli_malformed_user_message` |
| Delivery can be acknowledged | `--replay-user-messages` — *"Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)"* |
| Control requests exist too | `control_request` subtypes include `interrupt`, `set_permission_mode`, `set_model`, `get_context_usage` |

So the channel is real, it is documented by the binary we ship against, and it has an
acknowledgement built in. It is not verified against a running CLI, by rule; the fake-CLI tests in
task group 6 pin our end of the contract, and the first real turn after deploy is the confirmation.

### Why it does not work today

- `packages/runtimes/claude/src/args.ts:33` sends `--input-format text`.
- `packages/runtime-sdk/src/process.ts:24` — `child.stdin!.end(...)` — closes stdin before the turn
  has begun. Even with the right flag there would be nothing to write to.
- `packages/runtime-sdk/src/index.ts` — `TurnHandle` is `{ pid, cancel }`. There is no send.
- `RuntimeCapabilities.streamingInput` is declared and read by nothing: the only occurrences in the
  repo are its definition and the four adapter literals.

### The other three runtimes

`codex`, `gemini` and `opencode` all declare `streamingInput: false`, and the way we invoke them
(`codex exec`, `gemini -p`, `opencode run`) has no realtime input channel. PLAN §8's table records
that a warm process would mean `codex app-server` (JSON-RPC), `opencode serve` + `run --attach`, and
nothing at all for Gemini — three different builds, none of them this one. They get queued delivery
and the interface names the limitation. That is criterion 6, satisfied by telling the truth rather
than by building three transports.

## Goals / Non-Goals

**Goals:**

- One input path with two outcomes — `mid_turn` or `queued` — decided by what actually happened, and
  reported to the human every time.
- A live input channel that costs nothing when nobody is attached, so attaching is possible at any
  moment of a turn without the daemon having to predict it.
- No change to how a turn is spawned for any runtime that cannot take live input.
- The human's words on the ticket before any attempt to deliver them, so a delivery that fails still
  leaves a record.

**Non-Goals:**

- Terminal emulation, and anything resembling a PTY. Frames in, events out.
- Mid-turn `interrupt`, `set_permission_mode` or `set_model` control requests. The channel will carry
  them one day; this change sends `user` frames only, so attaching cannot change the agent's posture.
- Multiple humans attached to one agent as a modelled concept — the stream is already fan-out, and
  two composers would race on one channel. Out of scope per the ticket.
- Criterion 5, the interactive session. See `proposal.md` — the recommended split.

## Decisions

### 1. The channel lives on `TurnHandle`, not on a new service

`TurnHandle` gains `send?(text: string): Promise<InputDelivery>` where `InputDelivery` is
`'delivered' | 'closed' | 'unsupported'`. The engine already receives the handle and already
replaces `ActiveRun.cancel` with it (`engine.ts:271`); `ActiveRun.send` is set the same way, and the
rest of core reaches a running turn through `runState(ctx).active`, exactly as cancel does.

*Alternative considered:* a separate `AttachService` on `CoreServices`. Rejected — adding a member to
`CoreServices` breaks every test harness that proxies unstubbed services into a throw, for a service
that would hold one method and no state of its own.

### 2. `spawnLines` gets a stdin mode, defaulting to today's behavior

`SpawnOpts.stdin` stays as it is; a new `stdinMode?: 'close' | 'open'` defaults to `'close'`. In
`'open'` mode the child's stdin is left writable and the returned object exposes
`write(line: string): boolean`. The existing EPIPE swallow stays; a write after the stream has ended
returns `false` rather than throwing. Cancel and process close both end stdin.

Every adapter but Claude passes nothing and is spawned byte-for-byte as before.

### 3. The Claude adapter always runs with the live channel, and closes it on `result`

The head becomes `-p --output-format stream-json --verbose --input-format stream-json
--replay-user-messages`, the prompt is written as the turn's first `user` frame, and there is no
prompt operand and no plain-text stdin (so `MAX_ARGV_PROMPT` stops applying to this adapter).

The important half: **the adapter ends stdin as soon as the parser sees the turn's `result` line.**
The CLI keeps the session alive for as long as stdin is readable, so without this the process would
never exit and every turn would hang until its timeout. Ending stdin on `result` keeps the turn's
shape exactly what the engine already expects — spawn, stream, exit — and gives "mid-turn" a precise
boundary: input is deliverable from spawn until the result frame, and `send()` reports `closed`
after it.

*Alternative considered:* opening the channel only while somebody is attached. Rejected — a human
attaches partway through a turn, and stdin cannot be reopened on a running process. The channel has
to exist from spawn or it cannot exist at all.

*Alternative considered:* leaving `--input-format text` and reopening a second process for input.
Rejected — two processes are two sessions.

### 4. Delivery is confirmed by the CLI, not assumed by us

`--replay-user-messages` makes the CLI echo each consumed `user` frame back on stdout. `send()`
resolves `delivered` when the write succeeded; the echo is recorded as the acknowledgement on the
transcript event (`acknowledgedAt`). A frame written to a closed or full stream resolves `closed`
and the caller queues instead. Nothing reports `mid_turn` on the strength of a write we did not make.

`events.ts` must not treat a replayed `user` frame as a fresh turn input or as a tool result; it is
matched to the frame we sent and folded into the existing human-input event.

### 5. One method, two outcomes: `workers.message(actor, id, body, { live })`

Order matters and is fixed:

1. Record the ticket comment (`kind: 'relay'`, `authorKind` from the actor). Attribution first, so a
   failed delivery still leaves the human's words on the record.
2. If `live` and the agent has a run in `runState().active` with a `send`, try it.
3. `delivered` → record a `human.input` run event with `delivery: 'mid_turn'`, and **do not** enqueue
   a wake: the running turn already has the text, and a wake would deliver it a second time.
4. Anything else → enqueue the `conductor_request` wake exactly as today, and record the event with
   `delivery: 'queued'`.

Return `{ delivery, runId, wake }`. The existing conductor relay calls it without `live` and keeps
queued behavior, so its one path is unchanged in effect.

*Alternative considered:* a second method `messageLive`. Rejected — two methods means two places
where attribution and the never-drop rule have to be right.

### 6. A new run event type rather than a reused one

`RUN_EVENT_TYPES` gains `human.input`, payload `{ text, authorKind, authorId, delivery,
acknowledgedAt? }`. `user_input.requested` means the *agent* asked for input and would read backwards.
`packages/render` gets a case for it so the block shows the human's words, attributed, in the live
transcript and in every stored transcript the conductor can already inspect — criteria 3 and 7 with
no second record to keep in sync.

### 7. Capability is reported on the worker detail, not on a new route

`GET /workers/:id` gains `input: { midTurn: boolean; reason?: string }`, derived from the runtime's
`streamingInput` and whether a live run with a channel exists. The composer reads it to label itself
before the human types, and to name the limitation on a runtime that cannot do it. Following VS-78:
a per-runtime constant belongs on the adapter, and the surface reads it off a response that already
exists.

### 8. Attach and detach are not modelled server-side

Attaching is subscribing to `GET /runs/:id/events/stream` and `GET /events`, both of which exist. No
watcher is registered, no reference is counted, and the live channel is open for the whole turn
whether or not anyone is there. Criterion 4 therefore holds by construction, and a test pins it:
opening and closing a stream mid-turn changes nothing about the run.

### 9. Safety is the absence of code, and is tested as such

A human message is a `user` frame. The permission mode, the allow/deny lists and the charter are
fixed at spawn and nothing in this change touches them; no `set_permission_mode` or `set_model`
control request is ever written. A message does not answer an open decision — decisions are answered
only through the decisions surface. Both are pinned by tests rather than left as prose.

## Risks / Trade-offs

- **Every Claude turn changes shape, not just attached ones.** → The channel cannot be opened later,
  so this is unavoidable; it is contained by a `defaults.liveInput` boolean in `workspace.yaml`
  (default `true`) that returns the adapter to `--input-format text` and no `send()`, and by
  `buildArgs` staying a pure, unit-tested function whose new output is asserted whole.
- **A turn that never emits `result` would hold stdin open and hang to its timeout.** → The turn
  timeout and the kill-group escalation in `spawnLines` are unchanged and still end it; stdin is also
  ended on process close and on cancel, not only on `result`.
- **The prompt moves from argv to a stdin frame.** A frame the CLI rejects would leave a turn with no
  prompt at all. → `buildArgs` tests assert the exact frame, and the fake-CLI test asserts a turn
  whose only prompt source is the frame still produces a result.
- **`--replay-user-messages` echoes our own prompt frame back.** → The parser matches echoes to
  frames we sent and never renders one as new input; the golden fixture covers it.
- **Delivered mid-turn means the agent may act on it without the turn-start framing its brief gives.**
  → It is a user message in the same session, which is what the human asked for; the never-widen rule
  and the decision rule are what bound it.
- **A message sent in the instant a turn ends could be delivered twice or not at all.** → `send()`
  resolving anything but `delivered` queues instead, so the failure mode is a duplicate-free queue,
  and the outcome the human is shown is the one that happened.

## Migration Plan

No data migration. `defaults.liveInput` is an optional key with a default, so an existing
`workspace.yaml` parses unchanged. Rollback is setting it to `false`, which restores the current
spawn exactly; nothing persisted by this change needs unwinding.

## Open Questions

- Whether the CLI's realtime input arrives between tool calls or interrupts the model mid-stream is
  not stated by the binary and does not change any requirement here: either way it is `mid_turn`.
  Worth recording in the ADR once observed on a real turn.
