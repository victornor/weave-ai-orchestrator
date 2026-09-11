## Why

VS-261 scouted whether a worker's runtime process should survive a daemon restart and answered no —
none of the four production adapters have a long-lived process worth preserving; the session (a
CLI-owned file plus an opaque ref) already survives, for free, today. What it found instead: shutdown
already drains (`dispatcher.stop()` → unbounded `drain()`, then `cancelRunningRuns()`), but nothing
gives that drain time to run before the process is killed outright. `stopDaemon()` sends `SIGKILL`
after 10s; the systemd unit's `TimeoutStopSec` is 30s. Measured median turn durations (58s claude,
208s cursor, 305s opencode) all exceed both. So the daemon is `SIGKILL`ed mid-`shutdown()` on almost
every restart, `cancelRunningRuns()` never runs, and the turn's process survives as a reparented
orphan whose pipes just closed — stdin EOF, every subsequent stdout write `EPIPE` — narrating into
nothing while it keeps burning tokens.

It is worse on the deploy path (`daemon upgrade|restart|rollback`), which already calls
`POST /api/daemon/drain` before killing, with a budget the CLI defaults to 900s. That budget is spent
entirely *before* the kill signal is sent; when it is exhausted with turns still running, the route
does nothing about them beyond reporting them, and the kill sequence that follows repeats the same
10s/30s race against the same still-running turns. An operator who asked for fifteen minutes of grace
gets thirty seconds. The raw signal path (`daemon stop`, a `systemctl --user stop`, a host reboot, a
plain `kill`) never calls `/api/daemon/drain` at all, so it gets no deliberate grace period whatsoever.

## What Changes

- **`shutdown()`'s own drain becomes bounded**, not unbounded: it waits up to a fixed grace period for
  in-flight turns to finish naturally, and if that expires, cancels every workspace's still-running
  turns through the same path `/runs/:id/cancel` uses, waits a second, shorter bounded period for
  those cancellations to land, and only then proceeds to close listeners and databases. This is the
  fix for the raw signal path (`daemon stop`, a `systemctl --user stop`, a host reboot, a plain
  `kill`) — it now gets a deliberate, bounded grace period baked into the daemon itself, instead of
  whatever an external kill timeout happens to leave it.
- **The external kill timeout is raised to comfortably exceed that bounded shutdown's own worst-case
  time**, so the daemon's own graceful exit always finishes before it: `stopDaemon()`'s default
  timeout and the installed systemd unit's `TimeoutStopSec` both derive from one shared constant.
  Neither needs to know the operator's chosen drain budget at request time, because that budget is
  now fully spent *before* any kill signal is sent (see the next point) — the kill timeout only has to
  outlast `shutdown()`'s own fixed, small bound.
- **`POST /api/daemon/drain` cancels on its own timeout** instead of only reporting still-running
  turns and leaving them for the kill signal that follows to (fail to) interrupt. This is what makes
  the CLI's existing "N run(s) were still going and got interrupted" message true rather than
  aspirational.
- **`daemon stop` gets the same deliberate pre-drain step** `daemon restart`/`upgrade`/`rollback`
  already have: it calls `/api/daemon/drain` before sending its kill signal, instead of going straight
  to a raw `SIGTERM`.
- `Dispatcher.stop()` gains an optional bounded-timeout form (returning whether it actually drained in
  time) that both `shutdown()` and the drain route use, replacing the drain route's own ad hoc
  `Promise.race` (which today leaves the underlying `dispatcher.stop()` call running in the
  background, uncancelled, after the route has already responded).

## Explicitly not in scope

Restated from the ticket, unchanged by this proposal: no detached, daemon-outliving host process; no
acknowledge-after-commit for runtime events; the true crash case (OOM, segfault, power loss) is left
to `bootRecovery`, which already kills any orphan by process group and re-queues the turn at next
boot — including, as a safety net, a turn this change cancels but whose `finalize()` did not land
before the daemon exited.

## Capabilities

### New Capabilities

- `daemon-shutdown/graceful-drain`: `shutdown()`'s bounded drain-then-cancel sequence, and the
  requirement that every kill timeout that can follow it (`stopDaemon`, the systemd unit) exceeds its
  worst-case time.
- `daemon-shutdown/deploy-drain`: the deploy path's drain-before-kill sequence — `/api/daemon/drain`
  cancelling on its own timeout, and `daemon stop` getting the same deliberate pre-drain step
  `restart`/`upgrade`/`rollback` already have.

## Impact

- `packages/shared/src/daemon-shutdown.ts` (new): `SHUTDOWN_DRAIN_GRACE_MS`,
  `SHUTDOWN_CANCEL_GRACE_MS`, `SHUTDOWN_KILL_GRACE_MS` — the one place these numbers are spelled.
- `packages/core/src/api.ts` (`Dispatcher.stop()` signature), `packages/core/src/runs/dispatcher.ts`
  (bounded `stop()`/`drain()` implementation).
- `packages/server/src/daemon.ts` (`shutdown()`'s per-workspace sequence; exports
  `cancelRunningRuns` for the drain route to reuse).
- `packages/server/src/routes/daemon.ts` (`POST /daemon/drain` cancels on timeout).
- `packages/cli/src/daemon.ts` (`stopDaemon()`'s default timeout, `renderServiceUnit()`'s
  `TimeoutStopSec`).
- `packages/cli/src/commands/daemon.ts` (`daemon stop` gains a pre-drain HTTP call, mirroring
  `drainAndRestart`).
