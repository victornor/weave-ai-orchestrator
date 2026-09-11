## Why

Only the Claude adapter can take input while a turn is running. On cursor, codex, gemini and
opencode, a human's message to a working agent queues silently behind whatever the agent is
already doing — measured at a median of 208s (cursor) to 305s (opencode) before it is even seen.
"Queued" is truthfully reported today, but it means the human waits three to five minutes to be
heard, with no way to say "stop, you're going the wrong way" any faster than that. The machinery to
do better already exists (`spawnLines`'s `cancel('interrupt')`, `finalize`'s non-failure treatment
of an interrupt, a resumed-turn prompt note, session-ref resume) — it is simply never wired to a
live human message today.

## What Changes

- When a human sends a **live** message to a worker whose runtime cannot take mid-turn input, and a
  turn is currently running for that worker, the system interrupts that turn (the same
  `cancel('interrupt')` already used for daemon shutdown and `/runs/:id/cancel`) instead of queuing
  the message behind it, then dispatches the worker's next turn carrying that message and resuming
  the same session.
- `live: false` continues to queue exactly as today, on every runtime. Nothing about a live message
  to an **idle** worker changes either — there is nothing running to interrupt, so it queues for the
  next turn exactly as it always has.
- This is scoped to a message a **human** sends (the worker page / ticket page steer box, `POST
  /workers/:id/message`) — not `ac_worker_message`, the conductor's own steering tool, which keeps
  today's behavior unchanged on non-streaming runtimes even when it passes `live: true`. **BREAKING**
  for nothing external: this is additive for the one path it changes, and `ac_worker_message`'s
  documented contract ("tries mid-turn, falls back to queued") stays literally true for it. See
  `design.md` for why the line is drawn there.
- The interrupted run is recorded distinguishably: a new `errorCode` value on the `interrupted`
  status so it is never confused with a daemon-shutdown or generic cancel interrupt, and never with a
  failure.
- The message a live send interrupted for is delivered to the resumed turn at the same 8,000-char
  bound the system already gives a human's own words elsewhere (VS-242's thread messages, VS-246's
  ticket comments) — not the 160-char truncation `conductor_request` wakes use for their "why you
  were woken" line — marked when cut, with an explicit note that the previous turn was interrupted to
  deliver it.
- The human is told the delivery outcome is `interrupted`, a third value alongside today's
  `mid_turn` / `queued`, and the pre-send label (what an attached view says will happen before the
  human types) predicts this outcome where it applies.
- The UI's existing `interrupted` run status (already visually distinct from `failed` — a `stalled`
  glyph, `warn` tone) surfaces the new error code so a worker interrupted by its own human's message
  reads as "you interrupted this to say something," not as a crash.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `agent-attach/live-input`: adds a third delivery outcome (`interrupted`) for a live human message
  to a worker whose runtime cannot take mid-turn input while a turn of that worker's is running;
  requires the resumed turn to be told why and to receive the full message; requires the pre-send
  label to predict this outcome; requires the interrupted run to be recorded distinguishably from a
  failure and from a daemon-shutdown or generic interrupt.

## Impact

- `packages/core/src/workers/index.ts` (`message()`) — the interrupt branch and the third outcome.
- `packages/core/src/runs/active.ts` (`ActiveRun`, `describeLiveInput`, `recordHumanInputEvent`) —
  carrying the interrupt cause, predicting the third outcome.
- `packages/core/src/runs/index.ts` (`cancel()`) — an optional cause parameter.
- `packages/core/src/runs/engine.ts` (`finalize()`) — the distinguishing `errorCode`.
- `packages/core/src/prompts/index.ts` (`buildTurnPrompt`) — the interrupted-with-message note.
- `packages/shared/src/enums.ts` (`WAKE_SOURCES`) — one new wake source.
- `packages/core/src/api.ts` (`WorkerMessageOutcome`) — the third delivery value.
- `packages/server/src/routes/workers.ts` — response shape already passes `delivery` through; no
  route change expected beyond the type widening.
- `packages/ui` — `useWorkerMessage`'s outcome copy, the pre-send label, and the `interrupted`
  errorCode's display copy (`Runs.tsx`, `TicketPage.tsx`, or wherever the errorCode is already shown).
- No change to any runtime adapter, to ACP, or to the retry ladder.
