# Tasks — VS-461

## 1. Diagnose from real evidence

- [x] 1.1 Read the 2026-09-14 18:31–20:30Z runs' `events.jsonl` (VS-432/433/434/436) and establish, with file:line: the events the daemon received during the hang; why the silence detector did not interrupt or alarm; and where opencode's upstream error is available. Write it as a ticket `report` document, including what Claude, Codex, Cursor and Gemini expose. Verify: the report names the run ids and the code paths.

## 2. Progress-based silence

- [x] 2.1 `packages/shared/src/enums.ts`: export the set of non-progress run event types and `isProgressRunEvent`, so every reader agrees which events are progress. Verify: `pnpm typecheck` clean.
- [x] 2.2 `packages/db/src/migrations/0042_run_last_progress.sql`: add `runs.last_progress_at`; `packages/core/src/runs/engine.ts` stamps it on the turn-start update and on every progress event in `record`. Verify: a new run row carries a non-null `last_progress_at`, and a retry-noise event leaves it unchanged (covered by a test).
- [x] 2.3 `packages/core/src/supervisor/index.ts`: measure the silence window from `last_progress_at` (falling back to `last_event_at`, then `started_at`), and include the run's last recorded error message in the stall alarm and the `worker.stalled` event. Verify: a run whose only fresh events are `turn.started`/`session.resumed` is interrupted at the silence window; one emitting `assistant.text` is not.
- [x] 2.4 `packages/core/src/supervisor/supervisor.test.ts`: cover 2.2/2.3 timing with a fake runtime and seeded `run_events`/`runs` rows.

## 3. Surface the runtime's upstream error on the run

- [x] 3.1 `packages/runtimes/opencode/src/adapter.ts`: at turn end, read the opencode log bytes appended since spawn, keep the current session's `level=ERROR` lines, and emit a typed `error` run event carrying the provider, model and message; fold the message into `TurnResult.error`. Verify: a captured fixture line yields the event and a failed result.
- [x] 3.2 `packages/runtimes/opencode/test/`: a fixture of the 900-second `stream error` line drives the parse and the adapter's end-of-turn read.
- [x] 3.3 The run's error text is reachable from the run inspection: the typed `error` event renders in the transcript (`weave_run_inspect`, the run page) with the provider's message. Verify: the inspection transcript contains the message verbatim (redacted).

## 4. Repeated provider failures stop instead of looping

- [x] 4.1 `packages/core/src/supervisor/index.ts` (with the engine's existing park path): a silence-interrupted run whose preceding run was also silence-interrupted with no progress is parked — worker paused, ticket blocked, reason naming the last upstream error — instead of a third automatic resume. Verify: two consecutive no-progress cuts park; one does not.
- [x] 4.2 `packages/core/src/supervisor/supervisor.test.ts`: cover the stop-looping rule.

## 5. Suites and lint

- [x] 5.1 `pnpm lint && pnpm typecheck` clean.
- [x] 5.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report.