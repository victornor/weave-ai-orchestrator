# Design — provider errors and progress-based silence

## Progress-based silence

The watchdog currently measures silence from `runs.last_event_at`
(`packages/core/src/supervisor/index.ts:198`), which every recorded event updates
(`packages/core/src/runs/engine.ts:253`). Retry noise (`session.resumed`, `turn.started` for the
same message id) therefore resets the clock without the turn doing any work.

A fixed, exported classifier in `packages/shared/src/enums.ts` names the progress and non-progress
run event types. The engine stamps a new `runs.last_progress_at` whenever a progress event is
recorded, and sets it to the turn start when the run row becomes `running`. The watchdog measures
`now - (last_progress_at ?? last_event_at ?? started_at)` against `silenceTimeoutSec`. The existing
`worktreeTouchedSince` write-evidence deferral is unchanged.

The stall alarm's payload (`supervisor.action` `silence_interrupt`, and the `worker.stalled` event
the conductor digest already carries) gains the run's last recorded error message, so the alarm names
the provider error rather than only the silence.

## Repeated provider failures stop

The watchdog already enqueues one `retry` wake per interrupted run. A turn interrupted for silence
whose most recent prior run was also interrupted for silence *without progress* is the second
consecutive no-progress cut: instead of a third automatic wake the worker is parked — paused, the
ticket blocked with the last upstream error as the reason — the same shape the spent retry ladder
uses. One automatic resume after a no-progress cut is allowed; the second is not.

## The runtime's upstream error

opencode's own CLI logs the provider error (`message="stream error" … error.error.message="We were
unable to start processing your request within the 900-second timeout limit…"`) to
`<configHome>/opencode/log/opencode.log`, keyed by `session.id`; it never reaches stdout, so the
adapter's stream parser cannot see it. The adapter records the log size before spawn and, at turn
end, reads the bytes appended since then, keeps the lines for its own session at `level=ERROR`, and
emits a typed `error` run event carrying `provider`, `model` and the provider's message. Reading only
the appended range keeps the cost proportional to one turn, and a missing/short log degrades quietly.

Claude, Codex, Cursor and Gemini expose their API errors on the structured stream the adapter already
parses (inventoried in the ticket report); only opencode needed the log read.