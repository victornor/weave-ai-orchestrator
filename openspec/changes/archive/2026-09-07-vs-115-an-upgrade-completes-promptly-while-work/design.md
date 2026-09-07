## Context

There are two independent upgrade mechanisms in this codebase, and the ticket's incident touched both
without distinguishing them:

1. **The local CLI path** — `conductor daemon upgrade|restart|rollback` (`packages/cli/src/commands/daemon.ts`).
   An operator runs this directly, in the foreground, against a running daemon on the same host. It builds
   (or not, for `restart`/`rollback`), calls `POST /api/daemon/drain` bounded by `drainTimeoutSec`
   (`packages/server/src/routes/daemon.ts:140`), and then **restarts the daemon regardless of whether the
   drain finished** (`drainAndRestart`, `daemon.ts:369`). Anything still executing dies with the process
   restart and is already picked up by `bootRecovery` (`packages/core/src/supervisor/index.ts:115`) on the
   next boot: killed, marked `interrupted`, and re-queued as a retry. This path already does not lose work
   — it just waits too long by default (900s) before doing what it was always going to do anyway.
2. **The deferred/automatic path** — `conductor daemon update apply`, or the web app's Upgrade action
   (`packages/server/src/upgrade.ts`, `createUpgradeService`). This is the one meant to run unattended while
   a human might be chatting with the conductor. Its `advance()` holds dispatch immediately
   (`holdDispatch()`, before build even starts) and, if the wait for idle (`waitForIdleSec`, default 3600)
   expires, **aborts the whole upgrade** (`fail(id, 'wait_timeout', ...)`, `upgrade.ts:198`) rather than
   proceeding. This is what actually stalled tonight: dispatch stayed held for up to an hour holding the
   conductor's own turns hostage, then gave up entirely, so "upgrading never went ahead."

The ticket's own text names `drainTimeoutSec` as the culprit, but the incident's "silence" and "never went
ahead" symptoms trace to `waitForIdleSec` and `advance()`'s abort-on-timeout behavior, not the CLI path.
Both defaults are real and both are too long for a busy workspace, so both are addressed, but the
behavioral fix — proceed instead of abort — only applies to the deferred path, since the CLI path already
proceeds.

Separately, `packages/cli/src/upgrade-runner.ts`'s `driveRestart`/`recordVerdict` and
`packages/server/src/upgrade.ts`'s `reconcile()` are two independent, uncoordinated writers of the same
`upgrades` row's terminal state, running in different processes with no ordering guarantee between them.
`reconcile()` runs once, near-instantly, on every daemon boot, and its answer is an in-process fact (this
process's own release directory). `recordVerdict` runs after a health-probe loop that can legitimately take
up to 90s and can time out on a transient network hiccup even though the daemon is in fact healthy on
target; it then unconditionally overwrites the row, including performing an actual rollback+restart. That
is the race behind "the notice said failed while the new release was in fact running."

## Goals / Non-Goals

- Goal: no deferred upgrade can hold every workspace's dispatch for more than a short, configured bound
  without either completing the wait or proceeding anyway.
- Goal: a turn still executing when that bound is reached is never force-abandoned by upgrade code — it is
  handled by the restart-recovery path that already exists and is already tested.
- Goal: the chat carries an explicit "upgrading" message the moment dispatch is held, not just at the end.
- Goal: the stored upgrade outcome can never disagree with which release is actually running once the
  restart runner's own decision-making is involved.
- Non-goal: changing what a *genuine* rollback does (the `switchTo`/`spawnRunner`/backup mechanics
  themselves) — only preventing the runner from performing one against evidence it does not have.
- Non-goal: giving turns any new, finer-grained way to be interrupted or resumed than `bootRecovery`
  already provides — this change deliberately reuses that path rather than building a second one.
- Non-goal: touching the CLI-local path's restart mechanics beyond its default timeout value; it already
  behaves correctly.

## Decisions

**1. `waitForIdle`'s timeout branch proceeds instead of failing.**
Alternative considered: keep failing, just with a shorter bound, and tell the operator to retry. Rejected —
this is exactly the "upgrading never went ahead" symptom on a workspace that is *always* busy (many workers
running most of the time is the normal case here, not an anomaly); a bound that only ever fails buys
nothing. Proceeding relies entirely on machinery that already exists (`bootRecovery`) and is already tested,
so this is a small, well-understood change: `waitForIdle`'s `'timeout'` outcome in `advance()` is treated
the same as `'idle'`, except the record additionally captures how many runs were still executing
(`interruptedRuns`, alongside the existing `drainedRuns`).

**2. Both bounds default to 30 seconds.**
`waitForIdleSec` and `drainTimeoutSec` both drop from 3600s/900s to 30s. Rationale: since expiry no longer
means failure, the bound's only remaining purpose is to let the *fast* case — nothing running, or a turn a
few seconds from finishing anyway — go through without disturbing anyone. There is no value in waiting
longer than that: a turn that takes 30 minutes is not meaningfully closer to done at 30s than at 900s, and
every second beyond a small grace window is dispatch held for nothing. 30s is long enough to cover the
common case (idle, or a turn about to finish) and short enough that a busy workspace's upgrade completes in
well under a minute regardless of how many turns are mid-flight, because turns that do not finish in time
are interrupted and resumed safely rather than waited on indefinitely. Both remain overridable exactly as
today (`--drain-timeout`, `daemon.yaml upgrade.{drainTimeoutSec,waitForIdleSec}`).

**3. `wait_timeout` is retired as an `UpgradeFailureReason`.**
It can no longer be produced once decision 1 lands. Removing it (rather than leaving a dead enum member)
keeps `UPGRADE_FAILURE_REASONS` an accurate list of what can actually be read back from `GET
/api/daemon/upgrade`. This is a narrow, mechanical removal: the reason is set in exactly one place
(`upgrade.ts`'s timeout branch), and referenced in one enum, one type, two docs and two test files.

**4. The "upgrade started" chat message reuses the announcement's own channel path.**
Alternative considered: only update the web app's existing nav/settings banner (`packages/ui/src/lib/upgrade.ts`),
which already shows an "upgrading" state. Rejected as insufficient — the ticket is specifically that the
*chat* went silent, and a human watching the chat rather than settings has no reason to check there. The
new message is posted via `w.services.threads.notifyHuman(...)`, the exact call `announceTo` already uses
for the completion notice (`upgrade.ts:300`), fired once from inside `advance()` as soon as `holdDispatch()`
is called — before the wait, the build, or anything else. No new claim/dedup marker is needed: `advance()`
already runs exactly once per upgrade id, as a natural consequence of the `pipeline.then(() => advance(id))`
chain in `request()`.
The local CLI path is deliberately **not** given an equivalent message: it is an operator-invoked, foreground
command whose operator already sees `draining (up to Ns for running turns) …` printed to their own terminal
(`daemon.ts:374`); manufacturing a chat message there would also have to distinguish an upgrade from a plain
`daemon restart`/`daemon rollback`, which share the same drain route for reasons unrelated to upgrading.

**5. The restart runner treats reconciliation as more authoritative than its own health probe.**
Alternative considered: just guard `recordVerdict`'s DB write with `WHERE state = 'restarting'` (a CAS), and
stop there. Rejected as insufficient on its own: guarding the write prevents the *stored* outcome from being
wrong, but the runner would still have already performed a real, destructive rollback+restart against a
release that was in fact healthy — trading a stale-status bug for a silent-revert bug, which is worse.
Instead, `driveRestart`'s polling loop gains a second, faster exit condition alongside the HTTP health probe:
a read of the row's own `state` (via the same `daemon.sqlite` the runner already opens in
`runUpgradeRunner`). If reconciliation has already recorded `completed` — a fact only the daemon process
itself, on its own boot, ever writes, and only when its own release directory matches the target — the
runner stops and reports `completed` too, without ever calling `rollbackTo`. `recordVerdict` additionally
keeps the CAS guard (`WHERE state = 'restarting'`) as defense in depth for any ordering this still misses.
This is a small addition to `RunnerIo` (one more read seam, mirrored in `upgrade-runner.test.ts`'s fakes)
rather than a change to what rollback does when it is genuinely warranted.

## Risks / Trade-offs

- [A 30s bound is still occasionally too short to let a fast turn finish, so more upgrades will interrupt
  at least one run than would with the old 900s/3600s bounds] → Mitigated by design: interruption is no
  longer a failure mode, just the recorded `interruptedRuns` count: the turn resumes on its own once
  dispatch restarts, the same guarantee the CLI path already relies on today.
- [Posting a chat message on every deferred upgrade, including ones that resolve in a couple of seconds,
  adds a line the human may not have needed] → Accepted: a short "upgrading…" followed shortly by "back up"
  is a small cost against the alternative of silence during the (rarer, but real) upgrade that takes longer.
- [The new reconciliation-priority check in the runner reads the same sqlite file the daemon writes,
  from a second process, without an explicit lock] → Mitigated: this file is already read and written
  cross-process today (the runner already opens it for `recordVerdict`); the read is a single `SELECT`
  no different in kind from what already happens, and `better-sqlite3`/`node:sqlite` serializes access at
  the file level.

## Migration Plan

Config-only defaults and behavior changes within existing tables/columns (`interruptedRuns` is a new,
nullable column on `upgrades`, following the same migration pattern as `drainedRuns`). No data migration of
existing rows is needed: historical `upgrades` rows simply read `interruptedRuns: null`, same as they would
for any other field added after they were written. Nothing here changes wire formats other than additive
fields (`interruptedRuns` on `Upgrade`, `runs.interrupted` on `UpgradeAnnouncement`), so no client needs to
change to keep working; `packages/ui` is updated to show the new count where the drained/resumed counts are
already shown. Rollback of this change itself is a plain revert — no persisted state depends on the new
behavior existing.
