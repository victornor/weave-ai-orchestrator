## Context

See `proposal.md` — Why. Everything below was verified in the tree at `2eea56a`.

**What exists today.**

- `conductor daemon upgrade` (`packages/cli/src/commands/daemon.ts:204`) is the whole upgrade: it reads
  `upgrade.source`/`upgrade.ref` from `daemon.yaml`, calls `buildRelease`, `backupDatabases`
  (`:290`), `switchRelease`, `pruneReleases`, then `drainAndRestart` (`:313`). It refuses when
  `AC_RUN_TOKEN` is set, so an agent cannot run it.
- The release layout is in `packages/cli/src/release.ts`: `<data>/agent-conductor/releases/<stamp>-<sha>/`
  with `current` and `previous` symlinks (`:15`–`:21`), `buildRelease` cloning `--no-checkout` and
  building in `.building-<stamp>` before an atomic `renameSync` into place (`:75`), `switchRelease`
  swinging `current` and moving the old target to `previous` (`:105`), `pruneReleases` (`:114`).
  The clone keeps its `.git`, so a release directory can report its own commit.
- `POST /api/daemon/drain` (`packages/server/src/routes/daemon.ts:101`) calls `dispatcher.stop()` on every
  loaded workspace with a race against `timeoutSec`, then reports the runs still going. `undrain` (`:113`)
  calls `dispatcher.start()` on every workspace whose row is not `paused`.
- `CoreDispatcher.stop()` (`packages/core/src/runs/dispatcher.ts:107`) sets `state.stopping`, clears the
  1 s timer and awaits `drain()` — every in-flight `executeRun` promise. `running()` (`:57`) is
  `state.active.size`, the in-process count. This is exactly the hold-and-wait the ticket describes;
  nothing new has to be built in `core`.
- `deps.version` is `packages/server`'s `package.json` version (`packages/server/src/daemon.ts` `readVersion`).
  It is not the commit, so it cannot answer "is the source ahead".
- The systemd unit is written with `Restart=on-failure` (`packages/cli/src/daemon.ts:137`) and
  `ExecStart` pointing *through* the `current` symlink (`resolveServerBin`, `:22`), so a restart picks up
  a new release without rewriting the unit.
- `openDb` runs the whole migration set, and `daemon.sqlite` is opened with it, which is why `operator`,
  `auth_sessions` and `push_subscriptions` live in `0001_init.sql` alongside the workspace tables. A
  daemon-level table follows that precedent.
- The web app reconnects on its own: `EventStream` has backoff `[500,1000,2000,4000,8000,15000]`
  (`packages/ui/src/api/events.ts:20`) and `ConnectionBanner` renders the reconnecting/offline states.
  `AppShell` already renders a per-item badge in the rail (`packages/ui/src/app/AppShell.tsx:198`).
- `packages/cli` depends on `shared`, `render`, `tui`, `presenter` — **not** on `core` or `db`
  (`packages/cli/package.json`). `packages/ui` imports `@agent-conductor/shared`, so `shared` must stay
  browser-safe.

## Goals / Non-Goals

**Goals**

- Make "is there an update" answerable from the web app without a shell on the host.
- Make an upgrade a thing that waits for work rather than a thing that interrupts it.
- Keep the previous release running whenever the upgrade fails before the symlink swings — which is where
  almost every failure happens.
- Report the outcome of an upgrade *after* the restart that ended the session which requested it.
- Reuse the existing drain/undrain semantics, the existing release layout and the existing rollback
  mechanism rather than inventing parallel ones.

**Non-Goals**

- No scheduled or unattended upgrades. The ticket puts them out of scope.
- No change to the release directory layout, to `previous`-symlink rollback, or to
  `conductor daemon upgrade|releases|rollback`.
- No agent-facing surface. No new `ac_*` tool, no wake, no ticket. Upgrading the daemon is an operator
  action, and the run-token boundary is what enforces it.
- No cross-host upgrades. Everything stays host-local, as `release.ts` already says.
- No new daemon-level SSE stream.

## Decisions

### D1 — The release helpers move to a new leaf package `packages/release`

The daemon needs `buildRelease`, `switchRelease`, `pruneReleases`, `listReleases` and the path helpers.
They live in `packages/cli/src/release.ts`, which the server cannot import.

- *Alternative A — duplicate them in `packages/server`.* Two copies of the release layout is exactly the
  kind of drift that produces an unbootable host.
- *Alternative B — move them to `packages/core` and add `core` to the CLI's dependencies.* It works and the
  boundary guard allows it, but it pulls `core` (and `db`, and `node:sqlite`) into the startup path of
  every `conductor` invocation, for six path helpers.
- *Alternative C — a subpath export on `packages/shared`.* `shared` is imported by the browser bundle and
  is documented as "enums, Zod config schemas, `OcError`, event types, tool names, pricing, report shapes".
  `node:child_process` does not belong there.
- **Chosen — a new leaf package.** `packages/release` imports nothing from `@agent-conductor/*`, so the
  boundary guard needs no new rule. `packages/cli/src/release.ts` becomes a re-export, so no CLI call site
  changes. It is a file move plus two `package.json` edits plus a `tsconfig` reference, and it costs one
  line in the `CLAUDE.md` repo map.

### D2 — The daemon owns everything up to the symlink swing; a detached runner owns the restart

A process cannot restart itself from inside a request. Splitting on the symlink is what makes the failure
story simple: everything before it is undoable by doing nothing, everything after it is the runner's job.

- **In the daemon** (`UpgradeService`): the record, the dispatch hold, the idle gate, `buildRelease`,
  `backupDatabases`, `switchRelease`, `pruneReleases`. All of it is ordinary work the daemon already knows
  how to do, all of it is cancellable or recoverable, and none of it touches the running process.
- **In the runner**: restart, health-check, and on failure `switchRelease(previous)` + restart again. It is
  the new release's CLI bin (`cliBinIn(newRelease)`) under a hidden `daemon upgrade-runner <id>` subcommand,
  spawned detached. It writes its result straight into `daemon.sqlite` — it is a local process with file
  access, and the daemon it would otherwise ask is the one being restarted.

Restarting the daemon under systemd kills the service's whole cgroup, which would take a plain detached
child with it. The runner is therefore spawned through `systemd-run --user --scope --collect` when that is
available, which puts it in its own transient scope; on macOS/launchd and on a bare `conductor daemon start`
install a plain detached spawn already survives. The restart itself reuses the CLI's existing logic:
`systemctl --user restart` when the unit exists, otherwise `stopDaemon()` + `startDaemon()`.

- *Alternative — no runner: set `Restart=always` and have the daemon `process.exit(0)`.* Smaller, but it
  only covers systemd, it silently requires every existing install to reinstall its unit, and it has
  nobody to roll back when the new release does not boot.

### D3 — Boot-time reconciliation is the backstop, not the mechanism

If the runner cannot be kept alive (systemd present, `systemd-run` absent), the restart still happens and
the record is still `restarting`. So the daemon reconciles on startup: a `restarting` record whose target is
the release this process is running becomes `completed`; one that is not, past a bounded interval, becomes
`failed`; any pre-`restarting` non-terminal record left by a dead process becomes `failed`, so a stale row
can never hold dispatch in a fresh daemon.

This is a backstop for the record, not for the host: automatic rollback when the new release does not boot
is the runner's job and only the runner's. When there is no runner, the human rolls back with the
`conductor daemon rollback` that already exists. Stating that plainly is better than implying a guarantee
the design cannot make on every platform.

### D4 — The idle gate is `dispatcher.stop()` plus `running() === 0`, per loaded workspace

`stop()` already means "no new runs, and await the ones in flight". The gate is `Promise.all(stop())`
raced against `upgrade.waitForIdleSec`, then an assertion that every `running()` is zero. Cancel and the
timeout path both call the existing `undrain` logic: `start()` on every workspace whose row is not `paused`.

Deliberately **not** gated on the `runs` table: a row left `running` by a daemon that crashed would block
every future upgrade forever. `running()` is the in-process truth, and it is what `stop()` waits on.
Queued wakeups are also not part of the gate — holding dispatch is precisely what keeps them queued.

`waitForIdleSec` defaults to 3600. Waiting forever matches "deferred until no work is running" most
literally, but one wedged run would then hold every workspace's dispatch silently and indefinitely; a
generous bound with a visible failure and an automatic resume is the safer default, and the record shows
what it is waiting for the whole time.

### D5 — The update check is `git ls-remote`, cached

`git ls-remote <source> <ref>` resolves the target commit without a clone, without a working tree and
without touching the installation, and it works for both a URL and a local path — the two things
`upgrade.source` can be. The running commit is `git -C <releaseRoot> rev-parse HEAD` (the release keeps its
`.git`), falling back to the `<stamp>-<sha>` suffix of the release directory name, and reported as unknown
if neither works. "Running release" is derived from `import.meta.url`, not from the `current` symlink, so a
daemon that has not yet restarted after a swing reports what it is actually running.

Cached for `upgrade.updateCheckIntervalSec` (default 900) with the check time reported, and refreshable
with `?refresh=1`. No `upgrade.source` means `configured: false` — not an error and not an update, so the
web app shows nothing, which is what the acceptance criterion asks for.

### D6 — Progress is polled, not streamed

The SSE stream is per-workspace and dies at the restart anyway; a daemon-level stream would be a new
transport built for one screen. `GET /api/daemon/upgrade` polled on an interval while the state is
non-terminal is less code, survives the restart for free (the poll simply fails and retries, which is also
how the client detects that the daemon came back), and the record is small. Build output is kept as a
bounded tail on the record (`UPGRADE_LOG_LINES = 200`), so the response stays small and a failure is
diagnosable without the host's log file.

### D7 — `conductor daemon upgrade` is left alone; the new CLI verbs are `conductor daemon update`

`conductor daemon upgrade` is the bootstrap path: it works when the daemon is not answering, which is
exactly when it is needed most. Rewriting it into a daemon client would remove that. The daemon-mediated
operations become `conductor daemon update` (status), `update apply` (queue and follow), `update cancel`.
Two commands with adjacent names is a real cost; the help text on each says which is which.

### D8 — Storage

One `upgrades` table in the shared migration set (`0007`), so it exists in `daemon.sqlite`:
`id`, `state`, `source`, `ref`, `target_sha`, `from_release`, `to_release`, `to_sha`,
`requested_by`, `requested_at`, `started_at`, `finished_at`, `reason`, `message`, `log_json`,
`backups_json`, `came_back_version`. No workspace scope — the daemon is not a workspace.

## Risks / Trade-offs

- **The runner is the one part that cannot be fully tested in vitest.** Its decision logic (which restart
  command, what to do on an unhealthy deadline) is a pure function and is unit-tested; the actual
  `systemd-run`/`systemctl` invocation is not, per the repo rule against shelling out to real tools in
  tests. Boot-time reconciliation (D3) is what keeps that untested path from producing a stuck record.
- **A held dispatch is a stopped workspace.** Between request and restart, nothing runs. That is the
  point, and the bound in D4 plus cancellation are the escape hatches.
- **`packages/ui` route tests mock `../api/hooks` wholesale**, so a component reaching for a new hook can
  break unrelated tests. `Settings` renders one section at a time, so the new hooks are only called when
  the Updates tab is selected; `AppShell` has no test today. Both are checked by running the web suite.
- **PLAN §6 enumerates the tables and the repo map enumerates the packages.** This change deviates from
  both, so it carries an ADR, per `CLAUDE.md`.
