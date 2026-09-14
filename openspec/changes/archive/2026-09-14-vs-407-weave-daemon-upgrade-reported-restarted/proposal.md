# A restart is refused when it would not take, and confirmed before it is called done

Tracker change for [VS-407](weave://tickets/VS-407).

## Why

On 2026-09-14 `weave daemon upgrade` on the owner's host printed
`restarted systemctl --user restart weave-ai.service · 61b0d566a9` while that release was the **old**
daemon, running outside the service unit and holding port 7433. The unit's restart crash-looped
(`listen EADDRINUSE`) for over 90 minutes (600+ restarts) and the old out-of-service process kept
serving. The CLI never checked which release answered, so it reported a restart that never happened,
and two Settings → Updates upgrades were later abandoned mid-build by the crash-looping unit.

The drain had also been silently skipped (`drain skipped: cannot reach the daemon at
https://100.64.0.10:7433 (fetch failed)`) even though a daemon was serving on that port. An upgrade
that cannot detect any of this is not an upgrade: it is a symlink change plus a hope.

The root cause, confirmed on the host on 2026-09-14: the stray daemon (pid 3563647, release
`61b0d566a9`) had been started **detached** by `weave daemon start` at 01:40 and ran in its own session
outside any systemd cgroup, tracked only in `<state>/daemon.pid`. `weave daemon stop|restart|upgrade`
branch on "a unit file exists", run `systemctl --user … weave-ai.service`, and return **without ever
signalling that tracked pid**; systemd cannot touch a process outside its cgroup, so the detached daemon
survived and kept :7433 while the unit hit `EADDRINUSE` on every `RestartSec=3`. The version reported
after the "upgrade" came from the orphan answering `/api/health`, so a health-endpoint probe cannot
confirm which process is serving. The manual fix was `kill -TERM 3563647`, remove the stale
`daemon.pid`, then `systemctl --user start weave-ai.service`.

## What Changes

- **Reconcile a detached daemon against an installed unit** on `weave daemon start|stop|restart|upgrade`.
  When a unit is installed and `daemon.pid` names a live process whose command line is this product's
  server `bin.js` and which is not the unit's main PID, the CLI **`SIGTERM`s that exact pid**, waits for
  it to exit and the listen address to free, removes the stale pid file, then continues with the unit.
  `start` reports the detached daemon and hands over rather than merely saying "already running". The
  pid's command line is verified and the port confirmed before anything is signalled; nothing is ever
  killed by pattern. Signalling is these human commands' alone: the daemon's own deferred self-upgrade
  and its restart runner **refuse**, and `weave doctor` **reports**, a detached daemon instead.
- **Preflight, before any restart** (local CLI `upgrade`/`restart`, and the daemon's own deferred
  self-upgrade): resolve the daemon's own listen address from its `daemon.json` and find the process
  holding it. When a service unit is installed and that process is not the unit's main PID, **refuse
  the restart**, print the holder's PID, command line and release path, and state that the unit cannot
  bind until that process stops. Nothing is ever killed automatically here.
- **Postflight, after a restart**: wait, bounded, for the installed unit to be `active (running)`
  without a restart loop **and** for the daemon serving on the listen address to be confirmed as the
  unit's own process (the unit's main PID, or a process in its cgroup) reporting the target release.
  Only then report `restarted`. Otherwise report the update/restart **failed**, naming the cause
  (e.g. `EADDRINUSE`, crash loop) and the release actually serving. This closes the defect where
  `drainAndRestart` printed success with the old release's version. Where no unit is installed, the
  release being served alone is accepted.
- **Drain reachability**: a drain that cannot reach a daemon is only legitimate when nothing is
  listening. When the listen address is reachable but the drain call fails, the restart is refused with
  the cause instead of skipping the drain. (Investigation: the failure was the client's configured
  public HTTPS URL against the self-signed listener — the context, not the daemon, was unreachable,
  which is why the old daemon kept serving.)
- **`weave doctor`**: checks for an out-of-service daemon holding the listen address, a unit in a
  restart loop (`NRestarts` climbing / `ActiveState` activating or failed), and a corrected "local
  daemon process" check — a unit-managed daemon (which writes `daemon.json`, not `daemon.pid`) must
  read as healthy, and a detached daemon coexisting with an installed unit must warn instead. Each with
  the exact remedy.
- **Abandoned self-upgrade cause**: when the booting daemon reconciles an interrupted (pre-`restarting`)
  record, the failure detail recorded for Settings → Updates states what actually restarted it — a
  crash-looping unit (`ActiveState`, `NRestarts`) or a daemon running outside its unit (a manual
  start/restart) — instead of a bare "the daemon restarted".

All host interaction stays behind injectable seams (`RunCommand`, a port-holder lookup, a running-sha
probe) and the VS-388 `AC_TEST_GUARD`; no test touches the real user manager, the unit, port 7433 or the
live daemon.

## Capabilities

### New Capabilities
- `daemon-upgrade/restart-safety`: the reconciliation of a detached daemon against an installed unit on
  start/stop/restart/upgrade, the preflight port-holder refusal, the postflight confirmation that the
  unit's own process is serving the target release, the drain-reachability rule, and the `weave doctor`
  checks that surface an out-of-service daemon, a restart-looping unit, and the corrected local
  daemon-process state.

### Modified Capabilities
- `daemon-upgrade/deferred-upgrade`: startup reconciliation of an interrupted upgrade records what
  restarted the daemon (crash-looping unit vs manual restart) in the abandoned failure detail.

## Impact

- `packages/release/src/index.ts` — leaf helpers: port-holder lookup, unit status (`ActiveState`,
  `SubState`, `NRestarts`, `MainPID`) parsing, restart classification; all seam-injected.
- `packages/cli/src/daemon.ts` — detached-daemon reconciliation (`SIGTERM` the verified tracked pid,
  wait for exit/port free, drop the stale pid file); unit-status and listener helpers; the guarded
  runner.
- `packages/cli/src/commands/daemon.ts` — reconciliation wired into `start`/`stop`/`restart`/`upgrade`;
  `drainAndRestart` preflight, drain rule and unit-identity postflight; `upgrade`/`restart`/`rollback`
  output only says `restarted` after confirmation.
- `packages/cli/src/upgrade-runner.ts` — preflight before the detached restart; crash-loop-aware probe.
- `packages/server/src/upgrade.ts` — preflight before `spawnRunner`; richer `abandoned` message in
  `reconcile()`.
- `packages/cli/src/commands/doctor.ts` — the out-of-service, restart-loop and corrected local
  daemon-process checks.
- Tests: `packages/release`, `packages/cli` (`upgrade-commands`, `upgrade-runner`, `daemon`,
  `daemon-stop`, `doctor-command`), `packages/server` (`upgrade`).
- No schema or API change; no dependency change.
