## Why

A steer cannot stop a worker whose turn is already running. On a runtime that cannot take mid-turn
input, `weave_worker_message` records the message on the ticket and enqueues a `conductor_request`
wake that sits `queued` behind the executing run, so the correction only lands after the turn ends —
exactly what captain saw on ACME-166 on 2026-09-22 (a weaver steer labelled `queued` beside a turn
running 7m34s). The same is true of a human's comment on the ticket, which enqueues a `ticket_comment`
wake that queues behind the running turn. VS-657 already gave ticketless persistent sessions the
behaviour wanted: stop the running turn now and resume the same session with the message.

Scope widened by captain on 2026-09-22: the interrupt-and-resume rule applies to **every** steer of a
running ticket worker, whoever sends it — the weaver's `weave_worker_message`, a human's message or
comment on the ticket, a human's message in the worker's live view, and any other wake that carries a
human's words to a running worker.

## What Changes

- A steer sent to a **running ticket-bound worker** is delivered immediately. Where the worker's
  executing turn has an open mid-turn channel (claude, the built-in weave runtime) it is delivered
  into that turn; otherwise the turn is interrupted now — the runtime's own Escape-equivalent — and
  the worker's next turn resumes the **same session** carrying the message. It is never left `queued`
  behind the running turn.
- Every sender is covered: the weaver's `weave_worker_message`, a human's message in the worker's
  live view, a human's message or comment on the ticket (including a chat/channel message that lands
  on the ticket), and a human's answer to a decision the worker asked.
- Rapid steers sent while the turn is stopping coalesce into the single resumed turn, in order, each
  delivered exactly once.
- The sender's tool result and the transcript entry say which of **mid-turn / interrupted / queued**
  actually happened; an input that interrupted a turn is never labelled `queued`.
- The interrupted turn stays in the transcript, marked interrupted, with the tool calls it cut off
  marked not completed (the VS-657 marker, reused).
- The steer's own text is still recorded on the ticket as its sender's, in full, before any delivery
  is attempted.
- **Not changed:** the ticketless-session behaviour from VS-657, the weaver's own chat (still queues
  while its turn runs), a wake that carries no human or conductor words (a system wake, a retry, a
  ticket assignment, a plan submission, a scheduled walk), and an explicit `live:false` (still queues
  outright). A weaver's `weave_ticket_comment` does not wake the worker at all today and is unchanged.

## Capabilities

### New Capabilities

- `worker-supervision/running-worker-steering`: the rule that every steer of a running ticket worker
  is delivered immediately — mid-turn where a channel is open, otherwise by interrupting the turn and
  resuming the same session with the message — never queued; and that rapid steers coalesce into one
  resumed turn, each delivered exactly once.

### Modified Capabilities

- `worker-supervision/conductor-steering`: a conductor steer on a runtime with no open mid-turn
  channel interrupts and resumes instead of queuing; the conductor is told mid-turn, interrupted or
  queued.
- `agent-attach/live-input`: a human's message to a running ticket worker never queues — it is
  delivered mid-turn where the channel is open and otherwise interrupts; the conductor's steer is no
  longer carved out as a non-interrupting sender.
- `agent-attach/input-record`: the transcript entry's delivery value carries `interrupted` as well as
  `mid_turn` and `queued`, so an input that interrupted a turn is not shown as queued.

## Impact

- **core**: `packages/core/src/workers/index.ts` (`message` live path — interrupt for the conductor);
  `packages/core/src/tickets/service.ts` (`comment` — interrupt a running worker for a human comment);
  `packages/core/src/decisions/service.ts` (`answer` — interrupt a running worker for an answered
  decision); `packages/core/src/runs/active.ts` (a shared active-run lookup / interrupt helper);
  `packages/core/src/prompts/index.ts` (the interruption note fires for any wake carrying
  `interruptedRunId`, not only `human_message`). No new mechanism: `runs.cancel(actor, runId,
  'interrupt', 'message')`, the `live_interrupt` wake and `interrupted_by_message` finalize already
  exist (VS-254).
- **server**: `packages/server/src/tools.ts` (`weave_worker_message` description names the three
  outcomes); `routes/workers.ts` unchanged (already returns `delivery`).
- **render / ui**: the `human.input` transcript block's `delivery` gains `'interrupted'`
  (`packages/render/src/{types,transcript,inspect}.ts`, `packages/ui/src/lib/transcript.ts`,
  `packages/ui/src/components/Transcript.tsx`), so the label reads `interrupted`, not `queued`.
- **runtimes**: no adapter change — VS-660 already proves each adapter stops on `cancel('interrupt')`.
- No database migration: the delivery is already an event payload value and the interrupt marker is
  derived from `runs.status`.