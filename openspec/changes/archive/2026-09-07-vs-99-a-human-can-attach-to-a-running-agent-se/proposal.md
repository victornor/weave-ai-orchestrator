## Why

Today a human can watch a worker's transcript but can only talk to it by leaving a ticket comment,
which is delivered on the worker's *next* wake. There is no way to sit with an agent that is
mid-turn and redirect it while it is still working, so the human's only lever during a five-minute
turn is to cancel it. The write half of "attach" has never been built: the daemon closes the CLI's
stdin before the turn starts (`packages/runtime-sdk/src/process.ts:24`) and `RuntimeCapabilities.
streamingInput` is declared but read by nothing.

The transport unknown the ticket asked us to settle first is settled (evidence in `design.md`): the
Claude Code CLI accepts realtime input on stdin under `--input-format stream-json`, and the other
three runtimes we ship do not, under the way we invoke them. So mid-turn input is genuinely
available on Claude — the runtime every agent in this workspace runs on — and honestly unavailable
elsewhere.

## What Changes

- **A runtime may hold a live input channel for the duration of a turn.** `TurnHandle` gains an
  optional `send()`; `spawnLines` gains a mode that keeps the child's stdin open and writable
  instead of ending it immediately. Adapters that cannot deliver input omit `send()`, and their
  turns are spawned exactly as they are today.
- **The Claude adapter switches to `--input-format stream-json`.** The prompt becomes the turn's
  first `user` frame on stdin rather than an argv operand, `--replay-user-messages` gives us the
  CLI's own acknowledgement that a frame was consumed, and the adapter closes stdin the moment the
  turn's `result` frame arrives so the process still exits at the end of a turn. **BREAKING** for
  `buildArgs`' contract (the prompt no longer appears in argv or as plain stdin text) — internal,
  no HTTP or config surface changes shape.
- **Steering a worker becomes one path with two honest outcomes.** `workers.message` records the
  human's words as a ticket comment first, then attempts mid-turn delivery on the agent's live run;
  it reports `mid_turn` when the runtime took it and `queued` when it enqueued the wake instead.
  Nothing is ever recorded as delivered that was not, and nothing is dropped. **BREAKING**:
  `WorkersService.message` returns an outcome envelope rather than a bare `Wakeup` (internal).
- **The transcript records the human's input as an event**, attributed to them, so it appears in
  the live view, in the stored run, and in everything the conductor can already inspect.
- **The worker detail says whether mid-turn input is possible right now**, so the composer can say
  "delivered to the running turn" or "queued for the next turn" before the human types, and can name
  the limitation on a runtime that cannot do it.
- **The web worker page and `conductor attach` show the outcome** of each thing the human sends.
- Attaching stays a pure subscription to the event stream that already exists: nothing about a run
  depends on someone watching, and detaching changes nothing.

## Capabilities

### New Capabilities

- `agent-attach/attach-session`: what it means to attach to a running agent — the live view from the
  existing event stream, resuming mid-turn, and detaching without touching the run.
- `agent-attach/live-input`: delivering what the human types — mid-turn where the runtime genuinely
  supports it, queued to the next turn otherwise, always reported as one or the other and never
  silently dropped; and naming the limitation on a runtime that cannot take mid-turn input.
- `agent-attach/input-record`: the human's words are recorded on the ticket as theirs, appear in the
  run's transcript, and are instruction only — they never widen what the agent may do and never
  stand in for an answer to an open decision.

### Modified Capabilities

None. No existing requirement changes; `worker-supervision/run-inspection` and
`conductor-chat/live-turn-stream` keep working unchanged over the same events.

## Impact

- `packages/runtime-sdk`: `RuntimeCapabilities` (`streamingInput` becomes load-bearing), `TurnHandle`,
  `SpawnOpts`/`spawnLines`, `FakeRuntime` in the testkit.
- `packages/runtimes/claude`: `args.ts` (head flags, prompt placement), `adapter.ts` (live handle,
  stdin lifetime), `events.ts` (a replayed user frame is an acknowledgement, not a turn input).
- `packages/shared`: one new `RUN_EVENT_TYPES` entry for human input.
- `packages/core`: `runs/active.ts` (`ActiveRun.send`), `runs/engine.ts` (wire the handle),
  `workers/index.ts` (`message` outcome), `api.ts` (the wire shapes).
- `packages/server`: `POST /workers/:id/message` body and response, `GET /workers/:id` detail.
- `packages/render`, `packages/ui` (`WorkerPage`), `packages/tui` (`Attach`).
- `docs/API.md`, `docs/PLAN.md` §8/§14b.1, and a new ADR recording the stdin transport.

## Criterion 5 (the interactive session) is a separate build — recommended split

The ticket asked us to say so plainly if it turned out that way once the transport was understood.
It did. Criteria 1–4, 6 and 7 are one coherent change to how a turn's input channel works. Criterion
5 shares none of that machinery: it needs an agent that exists without a ticket (`workers.spawn`
requires one today, and the knowledge curator only gets in by having a ticket created for it first),
a home and worktree whose disposition at the end is a human decision, a prompt template that is not
a worker brief, its own lifecycle and screen, and a rule for turning the session's work into a
ticket. That is a second change of comparable size, and folding it in here would make one
unreviewable proposal.

**Recommendation:** approve this change as scoped (criteria 1–4, 6, 7) and file criterion 5 as its
own ticket. It should build on this one: the interactive session's whole value is typing into a live
agent, which is what this change makes possible. A follow-up ticket would need to cover a ticketless
agent bound to a project and a role, the session's worktree and its explicit fate (kept, discarded,
or promoted to a ticket) with unlanded work never discarded silently, and the session's transcript
and a closing summary being visible to the conductor afterwards.

If instead you want criterion 5 in this change, revise the plan and we will add it here.
