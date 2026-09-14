## Context

See `proposal.md` — Why. The restart path has two implementations that must agree:

- The **local CLI** path: `drainAndRestart()` in `packages/cli/src/commands/daemon.ts` runs
  `systemctl --user restart <unit>` (or `stopDaemon`+`startDaemon`), then polls `/api/health` for up to
  30s and returns whatever `version` answers — with no check that it is the release the upgrade aimed at.
  The local `upgrade`, `restart` and `rollback` commands all funnel through it.
- The **deferred self-upgrade** path: the daemon builds and swings `current`, then `launchRunner`
  (`packages/server/src/upgrade.ts`) starts a detached `weave daemon upgrade-runner`
  (`packages/cli/src/upgrade-runner.ts`), whose `driveRestart()` already verifies health against the
  target release, confirms the answering pid is the unit's, and rolls back on failure. It does **not**
  preflight the port holder, and its probe does not notice a crash-looping unit.

The confirmed root cause (2026-09-14) is a third shape both paths miss: a daemon started **detached** by
`weave daemon start` in its own session, outside any systemd cgroup, tracked in `<state>/daemon.pid`.
`stopDaemonService()`/`drainAndRestart` branch on "a unit file exists", ask systemd to stop/restart the
unit, and return **without signalling that tracked pid**; systemd cannot touch a process outside its
cgroup, so the detached daemon survives, keeps the port, and the unit loops on `EADDRINUSE`. The
`/api/health` version the CLI reports comes from whichever process answers — the orphan — so health
alone cannot name what is serving.

Both already have host interaction behind injectable seams: `RunCommand` (`packages/cli/src/daemon.ts`,
guarded by `assertHostCommandAllowed` / `AC_TEST_GUARD` from `packages/release`), `HostIo`
(`upgrade-runner.ts`), and `UpgradeDeps` (`packages/server/src/upgrade.ts`). Nothing here may reach the
real user manager, port 7433 or the live daemon in a test.

The daemon writes `<config>/daemon.json` with `{ pid, publicUrl, loopbackUrl, setupRequired, startedAt }`
when it starts listening (`packages/server/src/daemon.ts`), and `systemdMainPid()` already exists for
`systemctl --user show <unit> --property=MainPID --value`.

## Goals / Non-Goals

**Goals:**

- One set of host primitives for "who holds the listen address", "what state is the installed unit in",
  and "is the target release serving", used by the CLI preflight/postflight, the reconciliation path,
  the deferred upgrade's preflight/probe, and `weave doctor`.
- `weave daemon start|stop|restart|upgrade` hand a detached daemon over to the installed unit, and
  `upgrade|restart|rollback` refuse a restart that cannot take, only reporting success once it
  demonstrably has.
- The abandoned-upgrade record carries the actual restart cause.

**Non-Goals:**

- No automatic termination of an **unidentifiable** process outside the unit; stopping that is the
  operator's action. A detached daemon this product started and can positively identify (its own pid
  file, this product's server command line, holding the listen address) is signalled by the human CLI
  commands — `start`, `stop`, `restart`, `upgrade` — and by nothing else: the daemon's own deferred
  self-upgrade and its restart runner refuse, and `weave doctor` reports.
- No new `UpgradeFailureReason` or schema/API change — `restart_failed` (restart could not be carried
  out) and `abandoned` (stale pre-`restarting` record) already cover the outcomes.
- No Windows support and no new host dependency: `ss`/`lsof` are used opportunistically, never required.
- No change to the rollback-on-target-unreachable behaviour that already exists in `driveRestart`.
- No `--force` override; it is not requested and a definite finding is what refuses.

## Decisions

**1. Host primitives live in `packages/release` and take an injected `RunCommand`.** The package is
already the leaf host-interaction layer (`assertHostCommandAllowed`, `systemdMainPid`'s neighbours,
`planRestart`) and imports only `node:*`. Add pure functions:

- `readUnitRuntimeState(unit, run): { activeState, subState, nRestarts, mainPid }` — one
  `systemctl --user show <unit> --property=ActiveState,SubState,NRestarts,MainPID` and a parser. All
  fields `null`/`NaN`-free sentinels when unreadable.
- `parseListenPort(url): number | null` — the port from `daemon.json`'s `loopbackUrl`/`publicUrl`.
- `parsePortHolder(ssOutput | lsofOutput): { pid, command } | null` — parse a holder out of the two
  command forms; returned by a `findPortHolder(port, run)` that tries `ss -ltnpH 'sport = :<port>'`
  first, then `lsof -nP -iTCP:<port> -sTCP:LISTEN`, and returns `null` when neither yields one.
- `classifyRestart({ unit, holder, markerPid }): { outOfService: boolean; detail: string }` — the pure
  decision the preflight and doctor share.

The guarded runner moves to `packages/release` as `realRunCommand`, and `packages/cli/src/daemon.ts`'s
`realRun` re-exports it unchanged for its existing callers. `packages/server` imports `realRunCommand`
from `@weave-ai/release` rather than reaching into the CLI (which the dependency boundaries forbid).
*Alternatives:* duplicate a runner in the server (drift, and two guards to keep right); import the CLI
server-side (crosses a package boundary).

**2. Two independent out-of-service signals; the tracked daemon is handed over by the CLI, an
unidentifiable one is refused.** `daemon.json` carries the `pid` of the daemon that wrote it, and
`daemon.pid` names the process a local `start` spawned. Compare those with the unit's `MainPID`: a live
tracked pid that is not the unit's main PID is a detached daemon (Decision 8), and the port-holder
lookup is the second signal that names whoever actually holds the address. The human CLI commands
(`start|stop|restart|upgrade`) hand a verified detached daemon over; the daemon's own deferred
self-upgrade and `weave doctor` only refuse/report. Only a holder that is **not** the verified tracked
detached daemon and not the unit's own process, or a detached daemon seen by a component that must not
signal, causes a refusal — a definite finding, with the holder's PID, command and release path. When
both signals are inconclusive (no pid file, `ss`/`lsof` unavailable, no unit), the preflight proceeds:
a false refusal would block every upgrade on a host that merely lacks `ss`.

*Alternative:* rely on `lsof` alone — macOS-native but absent from many Linux hosts, and it would make
the decision depend on an optional tool.

**3. One `drainAndRestart` preflight, plus an early copy in `upgrade`.** `drainAndRestart` runs the
preflight for all three commands (restart/rollback/upgrade). `daemon upgrade` additionally runs it
before `buildRelease`, so a refused restart does not spend a build; `restart` and `rollback` do not build
and only need `drainAndRestart`'s copy. The local preflight reconciles a verified detached daemon first
(Decision 8) and then evaluates whatever holder remains; the deferred self-upgrade's own preflight
(Decision 6) has no reconciliation step and refuses instead, because the daemon must not signal.

*Alternative:* preflight only inside `drainAndRestart` — correct but a refused `upgrade` would build and
back up a release it then throws away.

**4. Drain rule probes the daemon's own listen address, not the configured context.** `drainViaHttp`
currently swallows every failure (`drain skipped: …`). New behaviour: on a drain exception, probe the
daemon's own `loopbackUrl` (falling back to its listen port) with a short reachability check. Nothing
listening → skip the drain and proceed (today's legitimate case). Something listening → refuse the
restart with the drain failure's message. This is exactly the incident: the configured context URL
(`https://100.64.0.10:7433`, self-signed) failed while a daemon served on the port.

**5. Postflight is a shared bounded poll over unit state, unit identity and a target-release answer.**
Extend `drainAndRestart` to take the target `{ release, sha }` (the built release for `upgrade`,
`currentLink()` for `restart`, `previousLink()` for `rollback`) and:

1. after the restart request, poll `readUnitRuntimeState`; a climbing `NRestarts` or a stuck
   `activating`/`failed` for a grace period is a crash loop;
2. poll `/api/health` **on the daemon's own listen address** and accept only a release path or commit
   matching the target;
3. confirm the process that answered is the unit's own — its `MainPID`, or a pid whose `/proc/<pid>/cgroup`
   names the unit (the same `confirmsReplacementViaSystemd` shape `upgrade-runner.ts` already uses for
   VS-316), so an orphan answering with the right version is not mistaken for the restarted unit. This
   matters most on `restart`/`rollback`, where the old and new releases are the same, so a release match
   alone cannot tell the orphan from the unit;

report `restarted` only when all three hold, otherwise throw an `ApiError` naming the cause (crash loop
or the last health/`EADDRINUSE` detail) and the release actually serving. Where no unit is installed,
verification is the target-release health answer plus the pid that was started, exactly as the runner
already does. In `upgrade-runner.ts`, `driveRestart`'s probe gains the same unit-state read through
`HostIo`, so a crash loop fails fast with `service crash-looping: …` instead of waiting out
`HEALTH_DEADLINE_MS`.

**6. The deferred upgrade preflights before it touches anything.** `UpgradeDeps` gains
`restartPreflight?: () => { ok: true } | { ok: false; message: string }`, defaulted to the real check.
`advance()` runs it after the idle wait and before `building`; on failure it records
`fail(id, 'restart_failed', message)` and `resumeDispatch()` without switching `current`. The runner
also preflights in `restartCommand().run()` before signalling, as the last line of defence for a host
that changed between the daemon's check and the restart.

**7. Abandoned records name the cause via a seam.** `UpgradeDeps` gains
`restartCause?: () => string | null`; `reconcile()`'s pre-`restarting` branch appends it to the existing
message (`the daemon restarted while the upgrade was <state> (<cause>)`). The real implementation reads
the unit's runtime state and the marker pid and returns "the unit <name> is restart-looping
(ActiveState=…, NRestarts=…)" or "the daemon was running outside its unit (a manual start/restart)" or
`null`.

**8. A detached daemon is reconciled by PID, never by pattern.** Add a `reconcileDetachedDaemon()` to
`packages/cli/src/daemon.ts`, called by `start`, `stop`, `restart` and `upgrade` (and by
`drainAndRestart` before it asks the unit to restart). It reads `pidFile()`, and only acts when a unit is
installed, the pid is live, `pid !== systemdMainPid(unit)`, the pid's command line contains this
product's server `bin.js`, **and** the pid holds the configured listen address (the same `findPortHolder`
lookup). It then `process.kill(pid, 'SIGTERM')`, waits bounded for the process to exit and the address to
free, and removes the stale pid file. `start` gains a branch that reports the handover instead of
"already running". No other component calls it: the daemon's self-upgrade refuses and `weave doctor`
reports, neither signalling.

Command line and address are re-verified at the moment of signalling, so a reused pid whose command line
is something else is reported and left alone. Every effect — `kill`, cmdline read, port lookup, wait —
goes through a seam, so tests drive it with a fake pid and assert the signal without a real process.
*Alternatives:* `pkill`/`killall` by pattern (explicitly forbidden — it would take the live daemon down
with the target); leave the detached daemon and make the operator stop it (this is the incident, and the
unit can never bind while it lives).

**9. Doctor's local-process check reads the unit too.** `daemon.pid` is written only by a local
`startDaemon`; a unit-started daemon writes `daemon.json`. The current check at
`packages/cli/src/commands/doctor.ts:116` therefore warns "not started from this machine" for a perfectly
healthy unit-managed daemon. The check becomes: local process healthy when the pid file names a live
process **or** the installed unit's `MainPID` is live and owns the listen address; a warning when a live
detached pid coexists with an installed unit, naming `reconcileDetachedDaemon`'s handover. It reuses the
same primitives as Decisions 1 and 8, so what doctor reports and what the CLI does cannot drift.

## Risks / Trade-offs

- **Holder detection can be inconclusive** (`ss`/`lsof` absent, or `/proc` restricted) → the preflight
  proceeds rather than refusing, so a host in that state keeps today's exposure. Mitigated by the
  marker/pid-file-vs-`MainPID` signal, which needs no external tool, and by doctor reporting when
  neither can be read.
- **A false refusal blocks an unrelated restart.** → Refuse only on a definite, unidentifiable holder;
  an inconclusive probe never refuses, and the verified detached daemon is handed over rather than
  refused. The remedy is printed rather than a `--force` that would hide the defect.
- **A reused PID could be signalled by mistake.** → The command line and the listen-address ownership
  are re-verified immediately before `SIGTERM`, and anything that does not match is reported, not
  signalled; only a pid this product started is ever the target.
- **A slow-but-healthy boot could be mistaken for a crash loop.** → A crash loop is a *climbing*
  `NRestarts` or a stuck `activating`/`failed`, not merely a not-yet-`active` state; a healthy boot that
  takes a few seconds is accepted the moment it reports `active` on the target.
- **The postflight probe runs from the CLI on the daemon host**, so it must use the loopback/own listen
  address, not the configured public context — the incident's own failure mode. → The target health
  probe uses the address from `daemon.json`, as `upgrade-runner.ts`'s `healthUrl()` already does.

## Migration Plan

No schema, migration or API change. The change ships in a normal release; the human runs
`weave daemon upgrade` as usual. A refused upgrade leaves `current` where it was (preflight runs before
the switch), so rollback needs no new path.

## Open Questions

None that change the approach. Whether to add a deliberate `--force`/`--allow-out-of-service` override
can be decided later from how often the refusal is hit in practice.
