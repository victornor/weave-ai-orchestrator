## Why

Captain (2026-09-07): "The conductor should have the tools to interject in worker sessions. Say the
user asks for something, the conductor dispatches a worker on a new ticket, then the user asks for
additions or changes. The conductor should be able to forward this to the worker, even though it has
already started."

VS-99 built exactly that channel — `WorkersService.message(actor, workerId, body, { live })` delivers
text to a running turn where the runtime can take it, and reports `mid_turn` or `queued` every time —
but by its own explicit design decision left the conductor's path out: *"The existing conductor relay
calls it without `live` and keeps queued behavior, so its one path is unchanged in effect."* The MCP
tool the conductor actually calls, `ac_worker_message`, takes only `{ workerId, message }` and never
asks for `live`, so a correction from the conductor always waits for the worker's next wake, however
long the current turn still has to run.

Two consequences seen today: a plan was written against superseded scope because the conductor's
correction landed after the worker's turn had started, and a worker had to be stopped mid-implementation
for the same reason.

## What Changes

- **`ac_worker_message` asks for mid-turn delivery by default.** The tool gains an optional `live`
  input (default `true`); the handler passes it straight through to `WorkersService.message`, which
  already does everything else — attribute the ticket comment first, attempt the running turn, fall
  back to the queued wake, and never double-deliver. No change to `WorkersService.message` itself: the
  service's own default (queued, when a caller passes no `live`) is untouched, and every mechanic VS-99
  built — attribution order, the exactly-once rule, the `human.input` event, the capability report —
  is reused as is.
- **The tool returns the delivery outcome** (`{ delivery, runId, wake }`) already produced by the
  service, so the conductor can tell captain whether a correction landed inside the running turn or
  will apply from the worker's next one, without guessing.
- **The conductor's own instructions and the `ac_worker_message` tool description say so plainly**:
  what `live` (default `true`) means, what the two outcomes are, and that a message never changes what
  a worker may do or answers a decision on its behalf — VS-99's rule, now stated for this path too.
- **Test coverage extends to the conductor's own path**: the tool defaults to `live: true` when the
  caller omits it, the outcome is `mid_turn` against a fake runtime that declares streaming input with
  a run in flight, `queued` when it does not or the channel has closed, the ticket comment is recorded
  in every case including when the send throws, and a mid-turn conductor message touches no permission
  mode, tool list or open decision.

## Capabilities

### New Capabilities

- `worker-supervision/conductor-steering`: the conductor's steering reaches a running turn where the
  runtime can take it, reports which of the two outcomes happened, is always attributed as the
  conductor's, never widens what the worker may do, and is delivered exactly once.

### Modified Capabilities

None. `agent-attach/live-input` and `agent-attach/input-record` already specify the mechanics this
change reuses for a second caller; they are not changed.

## Impact

- **Affected code**: `packages/server/src/tools.ts` (`ac_worker_message` input schema, handler,
  description). No change to `packages/core/src/workers/index.ts`, `packages/server/src/routes/
  workers.ts`, or any runtime adapter — all of VS-99's transport is reused unchanged.
- **Affected docs**: `templates/conductor.AGENTS.md.tmpl`, `skills/agent-conductor-conductor/
  SKILL.md`, `docs/PLAN.md` — the `ac_worker_message` description and the conductor's unblock-ladder
  guidance.
- **Breaking**: none. `WorkersService.message`'s signature and default are unchanged; only the
  conductor's tool now supplies an explicit `live: true` where it previously supplied none.
