## Diagnosis (origin/main 66917bba)

Both runs were classified `failed` by `finalize`'s runtime-error branch, not by its shutdown branch:

- The claude run ended `exit_143` / family `unknown`. That pair is exactly what
  `classifyError(143, stderr)` (`packages/runtime-sdk/src/process.ts`) returns, and the claude adapter
  attaches it as `result.error` (`packages/runtimes/claude/src/adapter.ts:192`). `finalize` tests
  `else if (r?.error)` *before* its shutdown condition, so the success of `r.exitCode === 143` in that
  condition never mattered: `!r?.error` was false.
- The opencode run ended `exit_1`, same shape, and exit 1 is not in the shutdown condition's code list
  at all.

The second gap is that a run which does finalize as `interrupted` during shutdown has its wakes marked
`failed` and its worker left `error`, and boot recovery only re-queues runs still marked `running`. So a
turn interrupted inside the shutdown's cancel grace would have been stranded even when the classification
was right. That is why the ticket's "boot recovery resumes them" needs the re-queue to actually happen.

The shutdown mark is also not visible to the engine at the moment it matters: `dispatcher.stop()` sets
`state.stopping` only after the channel/webhook/push stops have resolved, while systemd sends SIGTERM to
the whole control group, so the runtime children can exit and finalize before `stopping` is ever set.

The deferred upgrade path repeats this. Upgrade `01M2E3GN6QYZ7P8MK1GSAR84TZ` (19:22:12Z–19:26:17Z)
reported `runs: { drained: 4, interrupted: 4, resumed: 1 }`, yet two of the runs its restart cut off —
this ticket's own opencode run (`exit_1`) and VS-334's claude run (`exit_143`) — were finalized `failed`
and parked with retry cards. So the fix must cover the upgrade drain, and the announcement's
`interrupted`/`resumed` counts must be checked against what the restart actually recorded: `interrupted`
was a pre-restart snapshot and `resumed` counted every queued wake in the workspace.

## Decisions

### 1. A synchronous shutdown mark the engine can see

Add `shuttingDown: { reason: string; at: string } | null` to `RunRuntimeState`
(`packages/core/src/runs/active.ts`) and a `beginShutdown(reason)` method to the `Dispatcher`
interface. It sets `shuttingDown` and `stopping` in one synchronous call. `dispatcher.start()` clears
both, so a drain that is undone does not leave the workspace permanently "shutting down".

`shutdown()` calls `beginShutdown` for every workspace as its first statement, before its first `await`,
and before the drain/cancel sequence. `POST /api/daemon/drain` calls it before it stops and cancels, so a
`daemon stop`/`restart` that cancels inside the HTTP drain is classified the same way as one cancelled by
the SIGTERM path. A deferred upgrade is covered by the same signal: `upgrade.ts`'s wait-for-idle hold only
stops claiming, and the restart's own `SIGTERM` (or the drain that precedes it) sets the mark, so the runs
its wait left executing — the case in the 19:22Z upgrade — are recorded `interrupted_by_shutdown` and
resume.

### 2. Shutdown takes precedence in `finalize`, and re-queues

In `finalize` (`packages/core/src/runs/engine.ts`), before the existing shutdown/exit-code branch and
before the runtime-error branch, read `runState(ctx).shuttingDown`. If it is set and the run did not
succeed, the run is `interrupted` with `errorCode: 'interrupted_by_shutdown'`, `errorFamily: 'tooling'`.
Otherwise classification is exactly as today. This is deliberately blunt: during a shutdown a non-zero
exit or an attached error cannot be attributed to the worker, and resuming is safer than parking.

A distinct `interrupted_by_shutdown` code (alongside the existing `interrupted_by_message`) is what lets
the restart notice find exactly the turns the restart cut off, rather than every human interrupt.

For such a run the wake handling re-queues the run's own wakes (`status: 'queued'`, `runId: null`,
`claimedAt: null`) instead of marking them `failed`, reusing the existing `preserveWake` branch, and the
worker is left `active`. The dispatcher is not claiming while `stopping` is set, so the wakes wait; the
next daemon's dispatcher claims them on its ordinary cadence and the session resumes. A human cancel or
an ordinary failure does not set `shuttingDown`, so neither changes.

### 3. A durable lifecycle record in the daemon's own database

Use the daemon database's existing `meta` table (created by `Db.migrate`) with keys under
`daemon.lifecycle.*`: `boot_at`, `boot_release`, `boot_pid`, `shutdown_at`, `shutdown_reason`,
`failed_start_at`, `failed_start_reason`, `failed_start_count`. No migration and no new route.

A new `packages/server/src/restart-notice.ts` holds the reads and writes, pure where it can be:

- `observeBoot(db, { now, release, pid })` reads the previous records and returns
  `{ previousBootAt, downAt, shutdownReason, clean, failedStarts }` without writing. `clean` is
  `downAt !== null && downAt >= previousBootAt`; a boot with no `shutdown_at` after it is a crash.
- `markBooted(db, { now, release, pid })` writes `boot_at`/`boot_release`/`boot_pid` and resets the
  failed-start count. Writing only when the daemon is actually serving means a failed attempt leaves the
  previous boot record in place and is reported next time.
- `recordShutdown(db, reason, now)` writes `shutdown_at`/`shutdown_reason` at the top of `shutdown()`.
- `recordStartFailure(db, reason, now)` bumps the count and writes the last time and reason; it is called
  from a `try`/`catch` around the startup after the daemon database is open, then the error is rethrown.

### 4. Upgrade suppression by release identity

The restart notice is skipped when `observeBoot`'s `previousBootRelease` differs from this boot's
release. This is robust against ordering (the upgrade runner may have marked the row `completed` before
the new daemon's own `reconcile()` runs, so reading `state === 'restarting'` is not reliable), and it
also covers a CLI-initiated upgrade. It costs one more `meta` key and no new coupling to the upgrade
service. On the next boot on that same release a restart is announced normally.

### 5. The notice: one payload, one wake, one line

Add `RestartNotice` to `packages/shared/src/types.ts` with `kind: 'daemon.restarted'`, the boot and
down instants, `clean`, a `failedStarts` count/at/reason, and `interrupted: [{ runId, agentId,
agentName, agentKind, ticketId, ticketIdentifier }]`. The interrupted list is read per workspace from
runs created since the previous boot that are either `interrupted` with `error_code =
'interrupted_by_shutdown'` (finalized during the previous shutdown) or still `running` (orphaned by a
crash, which the supervisor's boot recovery re-queues moments later), joined to their agent and ticket.

`announceRestart(...)` mirrors `upgrade.ts`'s `announceTo`: `threads.notifyHuman` for the one short
line, then `wake.enqueue` to the workspace's weaver with `source: 'system'` and idempotency key
`daemon.restarted:<bootAt>`. It is fire-and-forget at boot, like the upgrade announcement, and its
failure is logged rather than fatal.

The chat line stays short, e.g. `Back up at 19:17 after a restart.` /
`Back up at 19:17; the previous shutdown was unclean.`, plus a clause naming failed start attempts and
the count of turns resuming. Detail lives in the wake payload.

### 6. Instructions

The template's existing upgrade-wake paragraph (item 6 of "Each turn") gains a sibling paragraph for the
restart wake, and the weaver skill gets the same short paragraph, so a weaver relays it as one summary
and carries on.

### 7. The upgrade announcement's counts come from the records

`upgrade.ts`'s `waitForIdle` snapshot (`interruptedRuns`) and `upgrade-announce.ts`'s `resumed:
facts.queuedWakes()` cannot agree with what the restart did: the first is a pre-restart count, and the
second counts every queued wake in the workspace, including wakes queued for other reasons. Derive both
at announcement time from the records: `interrupted` is the number of runs the restart recorded with
`error_code = 'interrupted_by_shutdown'` in the window, and `resumed` is how many of those runs' wakes
(the ids in their `wakeup_ids_json`) are `queued`. The recorded `drained`/`interrupted_runs` columns stay
as the upgrade's own historical record; the announcement no longer reads them for these two fields. This
is a fact of the workspace databases, like the landed-ticket list, so it fits the existing
`AnnouncementFacts` seam.

### 8. Tests

- `engine.test.ts`: a fake runtime result with exit 143 plus an attached `error` during a marked
  shutdown finalizes `interrupted` and leaves the wake queued; the same with exit 1. A failure without
  the mark keeps today's classification and wakes `failed`.
- `dispatcher.*`: `beginShutdown` makes the engine's mark visible synchronously and `start()` clears it.
- A supervisor/daemon-boot test that a still-running orphan is re-queued (existing) and that an
  interrupted finalize is not stranded.
- New `packages/server/test/restart-notice.test.ts`: pure builders plus a fake-workspace fixture, as
  `upgrade-announce.test.ts` does, covering clean restart, crash, failed start, first boot, and
  release-change suppression. No live daemon and no systemd units.
- `upgrade-announce.test.ts`: the interrupted/resumed counts are the recorded interrupted runs and their
  queued wakes; a turn that finished before the restart and an unrelated queued wake are excluded.

## Alternatives considered

- **Detecting shutdown from `state.stopping` alone.** Rejected: it is set too late in shutdown (after
  the async channel stops), which is exactly the race that produced `exit_143`.
- **Treating any `exit_143`/`137` with an error as interrupted outside shutdown.** Rejected: it would
  misclassify a CLI that really crashed; the shutdown mark is the honest signal.
- **Having boot recovery scan `interrupted` runs instead of re-queuing in finalize.** Rejected: two
  writers for the same resume, and a finalize-time re-queue is the narrower change.
- **Reusing the `upgrades` table to decide upgrade-vs-restart.** Rejected: the runner can complete the
  row before `reconcile()` sees it; release identity is stable.
