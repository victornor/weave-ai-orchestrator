# Job log flush timers are tracked and drained instead of firing against a closed database

For [VS-57](conductor://tickets/VS-57).

## Why

`JobsService.line()` arms a deferred write of the job's log tail
(`packages/core/src/jobs/index.ts:125` on `main` at `91514ff`):

```ts
if (!state.timer) state.timer = setTimeout(() => flush(jobId), JOB_LOG_FLUSH_MS);
```

The timer is stored on the job's live entry but nothing outside the service can cancel it, the
service has no `stop()`, and the timer is not `unref`'d. Between the last line and the flush the tail
lives only in memory, so any process that closes its workspace database inside that 250 ms window
gets the write anyway — from a timer, where a throw is an **uncaught exception**, not a failed write:

```
Uncaught Exception
Error: database is not open
 ❯ Db.run packages/db/src/db.ts:34:28
 ❯ flush packages/core/src/jobs/index.ts:63:12
 ❯ Timeout.<anonymous> packages/core/src/jobs/index.ts:125:56
```

`packages/server/test/jobs.test.ts` closes its database in `afterEach` with a flush pending, so this
takes the whole suite's exit code to 1 roughly one run in fifteen — the delivery gate of every worker
on this repository. The daemon hits the same path at shutdown: it drains the dispatcher and the
ticket service before closing each workspace database and then closes it with a job's tail still
unwritten.

This is the third instance of one class. VS-44 gave the ticket service tracked timers and a `stop()`;
VS-53 contained the projects service's detached rejection. The jobs service is the remaining one.

## What Changes

- The flush timer is `unref`'d and cleared through `flush` itself, so cancelling and writing are one
  path rather than two that can disagree.
- `JobsService` gains `stop(): Promise<void>`: it writes every tail still held in memory, disarms
  every timer waiting to do it, and marks the service stopped so a later line arms no new one. It
  never rejects and is safe to call twice. A job still `running` stays running — `reconcile()` already
  settles it on the next start; only its log tail is made durable here.
- `flush` never throws. The write is wrapped and a failure logs at warn with the job id, so the
  backstop for a caller that closes the database without draining is a warning, not a dead process.
- The daemon drains it during shutdown, immediately after the ticket service's drain and before it
  closes the workspace database, and in `unregister` before that path closes one.
- The suites that drive a real jobs service drain it in teardown: the server harness's `close()`
  (now async) and `projects.test.ts`'s `afterEach`.

Nothing about the cadence changes. Lines still go to the emitter synchronously, the tail is still
bounded at `JOB_LOG_LINES`, a step transition and `finish` still flush, and a job still persists its
tail at most every `JOB_LOG_FLUSH_MS`.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `workspace-setup/setup-jobs`: adds the guarantee that the deferred write of a job's log tail is
  cancellable and drained before the process disposes of its database, and never escapes as an
  uncaught exception.

## Impact

- `packages/core/src/jobs/index.ts` — tracked, unref'd timer; a non-throwing `flush`; `stop()`.
- `packages/core/src/api.ts` — `stop()` on the `JobsService` interface.
- `packages/server/src/daemon.ts` — the drain in `shutdown` and in `unregister`.
- `packages/core/src/jobs/jobs.test.ts`, `packages/core/src/projects/projects.test.ts`,
  `packages/server/test/fakes.ts` and the seven server test files whose teardown calls the harness's
  now-async `close()`.
- No API route, no wire shape, no database schema and no agent-facing tool changes.

## Out of scope

- Detached work outside the jobs service.
- Draining or cancelling an in-flight project add at shutdown — VS-53 ruled that out for the same
  reason it still holds: an add is minutes of `git clone`, and `setup-jobs` already settles a job left
  `running` by a previous process.
- The projects-service unhandled rejection that keeps `pnpm exec vitest run` at exit 1 on `main`
  today. That is VS-53's fix, which is not merged yet; this branch neither carries nor changes it.
