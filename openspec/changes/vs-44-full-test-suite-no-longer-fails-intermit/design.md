## Context

See `proposal.md` — Why. The facts that shape the approach:

- `createTicketsService(ctx, deps)` receives `deps` as a **thunk**, and in tests that thunk returns a
  `Proxy` whose getter throws for any service the test did not stub
  (`packages/core/src/testing/context.ts`). `deps().specs` therefore throws synchronously; the
  existing `.catch()` on `index()` is never reached.
- `merge-queue.test.ts:28` already stubs `specs`. `tickets.test.ts` does not, and it is the suite that
  drives `mergeDone`. So a stub alone would make today's failure go away.
- The service has two detached timers: `service.ts:317` (auto-merge sweep, 50 ms) and `service.ts:720`
  (spec re-index, 100 ms). Both are `.unref()`'d, neither is tracked.
- The daemon's shutdown loop (`packages/server/src/daemon.ts:131`) already stops channels, webhooks,
  the dispatcher and the supervisor per workspace before it closes each workspace database — there is
  a natural place to drain, and a clear ordering constraint against `db.close()`.

## Goals / Non-Goals

**Goals:**

- One mechanism in the ticket service for detached follow-up work, so a synchronous throw inside a
  timer callback can never become an uncaught exception.
- A deterministic way for a caller — the daemon at shutdown, a test at teardown — to end pending
  follow-up work, with no timing assumption on the caller's side.
- Production timing and triggers byte-for-byte unchanged.

**Non-Goals:**

- A general background-job facility shared across core services. Only the ticket service is in scope;
  if another service grows the same need, this is small enough to lift then.
- Making the follow-up work observable (no queue depth, no metrics, no events). Nothing asks for it.
- Retry or backoff for a failed re-index. Best-effort is the contract the spec states.

## Decisions

**A tracked-schedule helper inside the service, not a shared utility.** The helper is a closure over
the service's `log`: `schedule(delayMs, label, fn)` stores the timer id, and on fire removes it,
invokes `fn` inside `try`/`catch`, and stores the resulting promise until it settles. Both existing
call sites become `schedule(100, 'spec reindex after merge', () => deps().specs.index(pid))` and
`schedule(50, 'auto-merge sweep after in_review', () => service.autoMergeSweep())`. Timers keep
`.unref()`. *Alternative rejected:* wrapping each call site in its own `try`/`catch`. It fixes the
throw but leaves the timers untrackable, so the "10 runs in a row" criterion stays a matter of luck —
the timer still fires into a torn-down harness, just quietly, and can still touch a closed database.

**Both call sites, not only the re-index.** The auto-merge-sweep timer is safe from the synchronous
throw only by the accident that `autoMergeSweep` is `async`. It is untracked and uncancellable in
exactly the same way, and it also fires after teardown. Routing one and not the other would leave
`stop()` a half-truth. The change to that call site is mechanical.

**One `stop(): Promise<void>`, not a `flush()` and a `dispose()`.** Cancel every pending timer, then
`await Promise.allSettled` over the in-flight promises. It never rejects, resolves immediately when
nothing is pending, and is idempotent — a second call finds nothing to do. *Alternative rejected:* a
`flush()` that fires pending timers early instead of cancelling them. That gives a test a way to
force the work to happen, but at shutdown it is exactly wrong — the daemon wants the work gone, not
hurried — and a test that genuinely wants the work to run can advance vitest's fake timers and then
`await stop()` to drain it. One operation with one meaning beats two with overlapping ones.

**`stop()` does not make the service unusable.** It drains what is pending; it does not latch a
"stopped" flag that rejects later scheduling. Nothing needs that, and a latch would add a state a
test could trip over between cases. The daemon calls it once, at shutdown, on the way to closing the
database.

**Shutdown order: after the dispatcher, before `db.close()`.** The whole point is that follow-up work
must not outlive the database it reads. It goes in the same per-workspace loop as the other stops,
which already runs before the `db.close()` loop. Failures are logged like the neighbouring stops
(`log.warn`) rather than aborting shutdown.

**The harness gets a `specs` stub, and the ticket suites drain in teardown.** Both, not either. The
stub is what the service legitimately needs in order to do its job — `merge-queue.test.ts` already
provides one, so this only makes `tickets.test.ts` consistent — and the drain is what makes the
absence of a timer at teardown a property of the test rather than a coincidence. `afterEach` becomes
`await tickets.stop(); h.cleanup();`.

## Risks / Trade-offs

- **A test that stops the service too eagerly would silently cancel work it meant to assert on.** →
  `stop()` in teardown only, after the assertions; a test that asserts the re-index ran advances the
  fake timers first.
- **`stop()` awaits in-flight work, so a hung follow-up task would hang shutdown.** → The only work
  scheduled is a spec re-index and an auto-merge sweep, both already bounded and both already
  awaited elsewhere in the same process; adding a timeout would add a failure mode without a caller
  that needs it. Noted rather than mitigated.
- **`stop()` on the `TicketsService` interface reaches every fake that implements it.** →
  `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` proxy unstubbed members
  into a throw, so any suite that reaches `tickets.stop()` fails loudly until its fake supplies one.
  The task list includes a sweep of both harnesses.
- **Someone adds a third detached timer later and bypasses the helper.** → The two call sites are the
  only `setTimeout` in the service after this change, which makes a new bare one visible in review.
  No lint rule; not worth one for a single file.

## Migration Plan

None. No schema, no wire shape, no persisted state; the change is additive to an interface the daemon
and the tests are the only consumers of. Rollback is reverting the commit.
