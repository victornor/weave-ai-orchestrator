## 1. Shared constants

- [x] 1.1 Add `packages/shared/src/daemon-shutdown.ts` exporting `SHUTDOWN_DRAIN_GRACE_MS` (180_000),
      `SHUTDOWN_CANCEL_GRACE_MS` (45_000), `SHUTDOWN_KILL_GRACE_MS` (their sum plus a 30_000 margin) —
      design.md Decision 2. Export it from `packages/shared/src/index.ts`'s barrel.

## 2. Bounded `Dispatcher.stop()` (`packages/core`)

- [x] 2.1 Change `Dispatcher.stop()`'s signature in `packages/core/src/api.ts` to
      `stop(timeoutMs?: number): Promise<boolean>` (design.md Decision 4).
- [x] 2.2 Implement the bounded form in `packages/core/src/runs/dispatcher.ts`'s `createDispatcher`:
      no argument keeps today's unbounded `await drain()` behavior (returns `true`); an argument races
      `drain()` against a `setTimeout`, returning whether it drained before the timeout. Verified with
      `packages/core/src/runs/dispatcher.stop.test.ts`: a never-resolving queued turn (via
      `FakeRuntime.queue`) makes `stop(50)` return `false` in well under 1s, while nothing in flight
      returns `true` immediately, and the no-argument form still drains unboundedly.
- [x] 2.3 Verify calling `stop()` twice in a row (as the shutdown sequence in task 4 does) is safe:
      covered by the same test file's "calling stop() twice in a row is safe" case.

## 3. `packages/server/src/daemon.ts`: export `cancelRunningRuns`, bound `shutdown()`'s drain

- [x] 3.1 Export `cancelRunningRuns` (currently private) so `routes/daemon.ts` can reuse it (design.md
      Decision 3). No behavior change to the function itself.
- [x] 3.2 In `shutdown()`, replace the serial `for (const ws of ...) { await ...; await ...; }` loop
      over workspaces with `Promise.all([...new Set(workspaces.values())].map(async (ws) => { ... }))`,
      keeping every existing step inside each workspace's own body in its current order (`channels`
      → `webhooks` → `dispatcher` → `tickets` → `jobs` → `supervisor` → `cancelRunningRuns`), and
      replace the unconditional `await ws.services.dispatcher.stop()` with the two-stage bounded
      sequence from design.md Decision 1: `stop(SHUTDOWN_DRAIN_GRACE_MS)`, and on `false`,
      `cancelRunningRuns(ws)` followed by `stop(SHUTDOWN_CANCEL_GRACE_MS)`. Confirmed the `db.close()`
      loop is a separate pass after every workspace's own sequence settles, so nothing between
      workspaces was ordered.
- [x] 3.3 Test (`packages/server/test/daemon-shutdown.test.ts`, a new file alongside `daemon.test.ts`
      using the same real-daemon-boot harness): a `CancelableRuntime` (`FakeRuntime` subclass,
      `streamingInput = true`, a queued turn that never resolves on its own, `cancel()` overridden via
      the wrapped `onHandle` handle to record the call and resolve the turn). Dispatches it, calls
      `daemon.stop('test')`, and asserts: (a) it returns in well under `SHUTDOWN_KILL_GRACE_MS` (using
      the test-only `shutdownGraceMs` seam from 3.4), (b) `cancel` was called with `'interrupt'`, (c)
      the run's DB status (reopened after shutdown, since the workspace db closes as part of it) is
      `interrupted`. Passing.
- [x] 3.4 Added `StartOptions.shutdownGraceMs?: { drain: number; cancel: number }` to
      `packages/server/src/daemon.ts` — a test-only seam overriding `SHUTDOWN_DRAIN_GRACE_MS`/
      `SHUTDOWN_CANCEL_GRACE_MS` for one `startDaemon()` call, leaving the shipped constants (and every
      real caller, which never passes it) untouched. `DaemonHandle.stop()`'s own signature is
      unchanged.
- [x] 3.5 Test the exact scenario raised in plan review (`daemon-shutdown.test.ts`, second test):
      three workspaces, each with a `CancelableRuntime` stuck turn, `daemon.stop('test')`. Sized the
      grace periods (700ms drain, dominant since the fake's `cancel()` resolves its turn instantly) so
      a serial 3x multiplier (~2100ms) is unambiguously distinguishable from concurrent draining
      (~700–800ms actually observed); asserts total elapsed `< 1500ms` and all three runtimes'
      `cancel` were called. Verified this test fails (elapsed ~2109ms) against a temporarily
      reintroduced serial loop and passes against the `Promise.all` version — confirmed as a real
      regression test, not by inspection alone.

## 4. `packages/server/src/routes/daemon.ts`: cancel on drain timeout

- [x] 4.1 Rewrite `POST /daemon/drain` to call each workspace's `dispatcher.stop(timeoutSec * 1000)`
      directly (dropping the route's own `Promise.race`/`setTimeout` construct, now redundant per
      design.md Decision 3) and, when a workspace did not drain in time, call `cancelRunningRuns(w)`
      (imported from `../daemon.js`) before composing the response. Response shape (`{drained, running,
      workspaces}`) is unchanged. (Creates a circular import `daemon.ts` → `app.ts` →
      `routes/daemon.ts` → `daemon.ts`; safe here since `cancelRunningRuns` is only referenced inside
      the route handler closure, never at module-evaluation time — confirmed by running the suite.)
- [x] 4.2 Test in `packages/server/test/daemon-drain.test.ts` (new file, `fakes.ts`'s harness): a
      timed-out dispatcher (`h.impls.dispatcher!.stop` returns `false`) with one reported-running run
      asserts `runs.cancel` is called with `('interrupt')` before the response, and that the response
      still reports it under `running`; a dispatcher that drains in time or isn't given the chance to
      time out asserts `cancel` is never called.

## 5. Kill-timeout consistency (`packages/cli/src/daemon.ts`)

- [x] 5.1 Change `stopDaemon`'s default parameter from `timeoutMs = 10_000` to
      `timeoutMs = SHUTDOWN_KILL_GRACE_MS` (imported from `@agent-conductor/shared`).
- [x] 5.2 Change `renderServiceUnit()`'s hardcoded `TimeoutStopSec=30` to
      `` `TimeoutStopSec=${Math.ceil(SHUTDOWN_KILL_GRACE_MS / 1000)}` ``. New
      `packages/cli/src/daemon.test.ts` asserts the rendered unit's `TimeoutStopSec` line matches the
      shared constant.
- [x] 5.3 Test `stopDaemon` itself (`packages/cli/src/daemon.test.ts`) against a real, spawned inline
      child process standing in for the daemon (trapping `SIGTERM`, writing a marker file and exiting
      only after a controllable delay — `SIGKILL` cannot be trapped, so a missing marker proves the
      kill landed first). Asserts `stopDaemon(shortTimeoutMs)` kills the child (no marker) when it
      outlives the timeout, and does not (marker present) when it exits gracefully within it. Passing.

## 6. `daemon stop` gets a deliberate pre-drain step (`packages/cli/src/commands/daemon.ts`)

- [x] 6.1 Give the `daemon stop` command the same `POST /api/daemon/drain` pre-step
      `drainAndRestart` already has: an optional `--drain-timeout <sec>` (default `180`, matching the
      route's own default), reporting any interrupted runs the way `drainAndRestart` already does,
      before calling `stopDaemon()`. A drain-request failure is swallowed rather than blocking the stop.
- [x] 6.2 Factored into `drainViaHttp(command, drainTimeoutSec)`, used by both `daemon stop` and
      `drainAndRestart` (which keeps its own `client` for the `undrain`-on-systemctl-failure path).
- [x] 6.3 Test in `packages/cli/src/commands/daemon-stop.test.ts` (new file, following
      `upgrade-commands.test.ts`'s stub-HTTP-server + real `buildProgram()` pattern; `XDG_STATE_HOME`
      pointed at an empty temp dir so `stopDaemon()` is a real no-op with no pid file to touch):
      asserts the default and a custom `--drain-timeout` reach the request, interrupted runs are
      reported, and a 404'd drain route does not prevent the stop from proceeding. Passing.

## 7. Whole-change verification

- [x] 7.1 Confirmed by reading: `packages/cli/src/upgrade-runner.ts`'s `restartCommand()` uses
      `planRestart()` (`@agent-conductor/release`), which either shells out to `systemctl --user
      restart <unit>` (now covered by the fixed `renderServiceUnit`) or falls back to this package's
      own `stopDaemon()`/`startDaemon()` (now defaulting to `SHUTDOWN_KILL_GRACE_MS`) — no edit needed
      in `upgrade.ts` or `upgrade-runner.ts`. (The macOS `launchctl kickstart` path is untouched by
      this ticket; launchd's own kill semantics are outside `TimeoutStopSec`'s scope and outside what
      the ticket's evidence — Linux/systemd timeouts — asked to fix.)
- [x] 7.2 Noted in design.md's "Risks / trade-offs" and restated in the delivery report: (a) an
      already-installed systemd unit keeps its old `TimeoutStopSec=30` until `conductor daemon
      install-service` is run again; (b) `TimeoutStopSec=255` applies to every stop including a host
      reboot, a deliberate trade stated explicitly.
- [x] 7.3 `pnpm lint`, `pnpm typecheck`, `pnpm test` (both suites) all green — see the delivery report
      for both blocks verbatim. One pre-existing, unrelated flake observed and reproduced independent
      of this branch: `packages/server/test/app.test.ts`'s transcription test threw an unhandled
      `EPIPE` from `runCommand`'s `child.stdin.end(audio)` (a function this change never touches) on
      one full-suite run, passed both in isolation and on an immediate full rerun — not fixed here.
