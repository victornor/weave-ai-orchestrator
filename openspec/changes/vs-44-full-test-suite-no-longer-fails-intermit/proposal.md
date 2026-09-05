# Post-merge background work in the ticket service is contained and disposable

For [VS-44](conductor://tickets/VS-44).

## Why

`mergeDone` ends with a detached timer that re-indexes the project's specs
(`packages/core/src/tickets/service.ts:720`):

```ts
if (t.projectId) { const pid = t.projectId; setTimeout(() => { deps().specs.index(pid).catch(…) }, 100).unref(); }
```

The `.catch` only covers a rejected `index()` promise. `deps()` is a proxy whose getter **throws
synchronously** for any service the caller did not provide, so `deps().specs` throws before a promise
exists and the throw escapes the timer callback as an uncaught exception. The ticket-service tests
never provide a `specs` stub, and their harness tears down 100 ms after the last `mergeDone` — when
the timing lines up the timer fires into the ruins of a finished test and vitest fails the whole run.
Two workers (VS-32, VS-34) hit this at their delivery gate today and had to re-run the suite. Nothing
cancels the timer, and nothing can wait for it, so the failure is unreproducible on demand and equally
unpreventable.

The same service schedules a second detached timer at `service.ts:317` (the auto-merge sweep after
`in_review`). It happens to be safe today only because `autoMergeSweep` is `async`, so its throws
become rejections the `.catch` absorbs — but it is untracked and uncancellable in exactly the same
way, and it fires into a torn-down harness just as freely. One containment mechanism covers both.

## What Changes

- The ticket service gets one internal helper for scheduling detached follow-up work: it keeps a
  handle on every pending timer, runs the callback inside `try`/`catch` so a synchronous throw is
  logged instead of escaping the process, and records the resulting promise.
- Both existing detached timers (the post-merge spec re-index and the post-`in_review` auto-merge
  sweep) go through it. Their timing, their trigger and what they do are unchanged.
- `TicketsService` gains `stop(): Promise<void>`: cancel every pending timer, await the work already
  in flight, and resolve. Calling it twice is safe; calling it on a service with nothing pending
  resolves immediately.
- The daemon calls `tickets.stop()` during shutdown, before it closes the workspace database, so
  background work never runs against a closed database.
- The ticket-service and merge-queue test suites `await tickets.stop()` in teardown before
  `h.cleanup()`, and the harness gains a minimal `specs` stub for the tests that merge, so the
  re-index has something real to call.

## Capabilities

### New Capabilities

- `ticket-delivery/post-merge-background-work`: what the daemon guarantees about the follow-up work a
  ticket's merge schedules — that it still runs, that its failure is contained and logged rather than
  raised, and that it can be cancelled and drained deterministically on shutdown.

### Modified Capabilities

<!-- none: no existing requirement changes. -->

## Impact

- `packages/core/src/tickets/service.ts` — the scheduling helper, the two call sites, `stop()`.
- `packages/core/src/api.ts` — `stop()` on the `TicketsService` interface.
- `packages/server/src/daemon.ts` — `stop()` in the shutdown sequence.
- `packages/core/src/testing/context.ts` — a `specs` stub available to the harness.
- `packages/core/src/tickets/tickets.test.ts`, `packages/core/src/tickets/merge-queue.test.ts` —
  teardown drains the service.
- No API route, no wire shape, no database schema and no agent-facing tool changes.

## Out of scope

- Changing what the re-index does, or when a merge triggers it.
- Any other flaky test not caused by these timers.
- A general background-job runner for the rest of the core services.
