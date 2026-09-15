-- VS-461. A provider that accepts a request but never starts it keeps a runtime's retry loop alive
-- without any work being done. `last_event_at` alone cannot tell that apart from a turn making
-- progress, because the retry loop re-emits session/step-boundary events. `last_progress_at` is
-- stamped only for the event types `isProgressRunEvent` accepts (packages/shared/src/enums.ts) and
-- is what the supervisor's silence window is measured from; it is null on rows written before this
-- migration, and the watchdog falls back to `last_event_at` and then `started_at` for those.
-- `last_error` keeps the message of the most recent `error` event on the run row itself, so a run's
-- own transcript is not the only place the provider's words survive.
ALTER TABLE runs ADD COLUMN last_progress_at TEXT;
ALTER TABLE runs ADD COLUMN last_error TEXT;