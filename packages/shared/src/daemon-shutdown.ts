/**
 * VS-262: the daemon's own bounded shutdown sequence and the external kill timeouts that must
 * outlast it. `shutdown()` (packages/server) waits `SHUTDOWN_DRAIN_GRACE_MS` for in-flight turns to
 * finish naturally, then — if any are still running — cancels them and waits a further
 * `SHUTDOWN_CANCEL_GRACE_MS` for that cancellation to land as a recorded `interrupted` run.
 * `SHUTDOWN_KILL_GRACE_MS` is what every external kill timeout (`stopDaemon`'s default, the systemd
 * unit's `TimeoutStopSec`) derives from, so the daemon's own graceful exit always has time to finish
 * before it. See this change's design.md, Decisions 1 and 2.
 */
export const SHUTDOWN_DRAIN_GRACE_MS = 180_000;
export const SHUTDOWN_CANCEL_GRACE_MS = 45_000;
export const SHUTDOWN_KILL_GRACE_MS = SHUTDOWN_DRAIN_GRACE_MS + SHUTDOWN_CANCEL_GRACE_MS + 30_000;
