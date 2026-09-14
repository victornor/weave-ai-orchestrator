# The daemon survives an unexpected exit and workers cannot kill the live one

Tracker change for [VS-376](weave://tickets/VS-376). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

On 2026-09-13 the VS-354 worker, stopping its own scratch daemon, ran
`pkill -f "packages/server/dist/bin.js"`. The pattern matched the **live** daemon
(`~/.local/share/agent-conductor/current/packages/server/dist/bin.js`) as well as the scratch one.
The live daemon drained, cut off three workers' turns and exited **cleanly** (status 0) at 23:37:22Z.
The generated unit runs `Restart=on-failure`, so a clean exit is never restarted: the daemon stayed
dead until a human noticed. Captain then started it from a terminal, so it now runs outside
`weave-ai.service` (unit inactive, `MainPID=0`) and dies with that terminal.

Three failures compound: an operator-visible rule that did not exist (never kill by pattern), a
lifecycle that treats "exited on its own" as "stay down", and a helper-level hole (no safe way to run
a scratch daemon).

## What changes

- **The unit comes back after any unexpected exit.** `renderServiceUnit` emits `Restart=always`
  (keeping `RestartSec`). An explicit `systemctl --user stop` is still a deliberate stop — systemd
  does not restart a service stopped that way — so `weave daemon stop` and the guarded upgrade path
  keep their meaning. An installed unit that still carries `Restart=on-failure` is rewritten in place
  when an upgrade restarts it or when `weave doctor` runs.
- **`daemon start` and `daemon stop` go through systemd when a unit is installed.** With
  `weave-ai.service` (or the pre-rename `agent-conductor.service`) on the host, `start` runs
  `systemctl --user start <unit>` instead of spawning a detached process the caller's terminal owns,
  and `stop` runs `systemctl --user stop <unit>` after draining rather than `SIGTERM`-ing a pid that
  systemd would immediately restart. `daemon status` warns when a daemon answers outside its unit.
- **Workers cannot take the live daemon down by accident.** A new `scripts/scratch-daemon.sh
  start|stop` starts `packages/server/dist/bin.js` with a temp `--config-dir` and loopback port,
  records the pid in the scratch dir, and stops **only that pid**, after checking its command line
  names the scratch config dir. `CLAUDE.md`'s "Developing Weave AI inside Weave AI" says never
  `pkill`/`killall`/kill by name or pattern — the live daemon runs the same `bin.js` — and names both
  live-install paths (`~/.local/share/weave/current` and the older
  `~/.local/share/agent-conductor/current`).

## Out of scope

- Logging the sending pid on `SIGTERM`. Node exposes no sender, and the platform route is not cheap
  enough to be worth it; the ticket marks it optional and it is skipped.
- Any change to how the daemon drains or what it records on shutdown.
- A general rewrite of the unit's other fields: only the `Restart=` line is normalised.
