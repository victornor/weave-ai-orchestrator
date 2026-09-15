# Surface provider errors and alarm on a turn that only retries

Tracker change for [VS-461](weave://tickets/VS-461). A `task` ticket, so this change carries tasks
only — `skip_specs: true`. The diagnosis is a ticket `report` document, not a spec delta.

## Why

On 2026-09-14 18:31Z DeepSeek accepted opencode workers' requests but never started them. Every
request died after 900 seconds with "We were unable to start processing your request within the
900-second timeout limit", opencode retried the same message, and each retry died the same way until
the supervisor's 45-minute hard timeout cut the turn. Three worker turns (VS-432, VS-433, VS-434,
VS-436) were lost and the wave re-ran. Two things made it worse than it needed to be:

1. The run recorded only `errorCode: interrupted, family: tooling`. The provider's own message was
   written to opencode's own log file and never reached the run, so the weaver misdiagnosed it twice.
2. The silence watchdog measures the time since the last run event of *any* kind. opencode's retry
   loop emits `session.resumed` and a repeated `turn.started` (a `step_start` for the same message
   id), which are not progress but do reset that clock. A provider that retries faster than the
   silence window hides indefinitely.

## What changes

- **Progress, not events, ends the silence.** A fixed set of run event types counts as progress
  (model text and thinking, tool calls and results, commands, file writes, usage, plan proposals,
  errors, turn completion, human input). `session.*`, `turn.started`, `runtime.raw`, `run.*` and
  `supervisor.action` do not. The engine stamps `runs.last_progress_at` whenever a progress event is
  recorded, and the watchdog's silence window is measured from it (falling back to
  `last_event_at`/`started_at`). The existing stall alarm carries the run's last upstream error
  message when one was recorded.
- **The runtime's upstream error reaches the run.** The opencode adapter reads the provider error its
  own CLI logged for the current session and records it as a typed `error` run event, so the run's
  transcript (the run page and `weave_run_inspect`) shows *"provider deepseek: unable to start
  processing your request within the 900-second timeout"* instead of only "interrupted". The other
  shipped adapters are inventoried in the diagnosis; only opencode needed this.
- **A repeated upstream failure stops.** A turn interrupted for silence whose immediate predecessor
  was also interrupted for silence with no progress is not auto-resumed a third time: the worker is
  parked with the upstream error as the reason and the ticket blocked, the same shape the retry
  ladder already uses for a spent ladder.

## Out of scope

- Switching providers or models, and changing the 45-minute hard limit.
- A general provider-health dashboard. This is the run-level signal only.