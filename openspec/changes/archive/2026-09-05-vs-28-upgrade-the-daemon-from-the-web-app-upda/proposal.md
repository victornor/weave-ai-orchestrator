## Why

Upgrading the daemon is a shell task today. `conductor daemon upgrade` (`packages/cli/src/commands/daemon.ts:204`)
builds a release, backs the databases up, calls `POST /api/daemon/drain`, switches the `current` symlink
and restarts the service — all from a terminal on the daemon host, and all of it blind to whether anyone
is mid-turn. The drain is bounded by a timeout and reports what it *interrupted*: agents whose turns were
killed and have to resume. Nothing anywhere tells the operator that an upgrade is even available.

The web app is the primary surface for this workspace, and the daemon already knows everything needed to
close the gap: which release it is running, how many runs are executing, and how to hold dispatch. What is
missing is a persistent record of an intended upgrade, a gate that waits for zero running work instead of
interrupting it, and a surface for both.

## What Changes

- **The daemon knows whether an update is available.** It resolves the running release's commit, resolves
  `upgrade.source` at `upgrade.ref` with `git ls-remote`, and reports both plus whether they differ. The
  answer is cached and refreshable. With no `upgrade.source` configured, it reports "not configured" and
  the web app shows nothing.
- **An upgrade is a durable record, not a command.** Requesting one creates a row that moves through
  `queued → waiting → building → switching → restarting → completed | failed | cancelled`. It survives the
  restart, which is what lets the outcome be reported after the daemon comes back.
- **The gate waits instead of interrupting.** On `queued` the daemon stops dispatching in every loaded
  workspace — in-flight turns finish, no new run starts — and only moves to `building` when zero runs are
  executing in this process. It never cancels a run. The wait is bounded; on expiry the upgrade fails and
  dispatch resumes with nothing else touched.
- **Cancellation is possible until the build starts.** Cancelling a `queued` or `waiting` upgrade resumes
  dispatch on every workspace that is not itself paused — the same rule `undrain` already applies.
- **Failure before the swing changes nothing.** Clone, install, build and the optional test run all happen
  in a fresh release directory while the old daemon keeps serving. Any failure there marks the upgrade
  failed with its reason and its log tail, resumes dispatch, and leaves `current` untouched.
- **The restart is performed by a detached runner from the new release**, because a process cannot
  restart itself from inside a request. The runner restarts the daemon, health-checks it, and on failure
  swings `current` back to `previous` and restarts again. When the runner cannot survive its own restart,
  the daemon that boots next reconciles the record — so an upgrade never stays `restarting` forever.
- **The web app gets an Updates section in Settings** with the running version, the target, an Upgrade
  action, live progress with the log tail, and Cancel while it is still cancellable; plus a dot on the
  Settings entry in the navigation when an update is available. Reconnection during the restart is the
  existing SSE backoff and the existing connection banner — the section keeps polling and shows the
  outcome once the new daemon answers.
- **The CLI gets the same three operations** as a daemon client: `conductor daemon update`,
  `conductor daemon update apply`, `conductor daemon update cancel`. The existing local
  `conductor daemon upgrade` is untouched: it is the bootstrap path for a host whose daemon is not
  answering, and it stays a human command.
- **Agents cannot trigger an upgrade.** Every new route is operator-session auth, which run tokens do not
  satisfy.

## Capabilities

### New Capabilities

- `daemon-upgrade/update-availability`: how the daemon determines and reports whether the release source
  is ahead of the running release, what it reports when no source is configured, and how the answer is
  refreshed.
- `daemon-upgrade/deferred-upgrade`: the upgrade record and its lifecycle — requesting one, holding
  dispatch, waiting for zero running work, building, switching, restarting, cancelling, and how a failure
  at each stage leaves the previous release running and reports its reason.
- `daemon-upgrade/upgrade-surfaces`: what the web app and the CLI show and offer — the update indicator,
  the Upgrade action, live progress, cancellation, reconnection across the restart, and the outcome.

### Modified Capabilities

(none — no existing capability describes daemon lifecycle; `ticket-delivery` and the others are untouched.)

## Impact

- **New package**: `packages/release` — the host-local release directory and build helpers moved verbatim
  out of `packages/cli/src/release.ts`, so the daemon and the CLI share one implementation without the CLI
  taking a dependency on `core`. Leaf package, imports nothing from `@agent-conductor/*`.
- **Schema**: a new `upgrades` table (migration `0007`) in the shared migration set, so it exists in
  `daemon.sqlite`. Additive, no backfill. PLAN §6 enumerates tables, so the deviation gets an ADR.
- **Server**: a new `UpgradeService` owning the record, the idle gate and the runner hand-off; four routes
  under `/api/daemon`; `AppDeps` gains the service; the daemon reconciles a `restarting` record on boot.
- **Config**: `upgrade` in `packages/shared/src/config.ts` gains `waitForIdleSec` and
  `updateCheckIntervalSec`. Existing keys unchanged.
- **CLI**: three subcommands under `conductor daemon update`, and `packages/cli/src/release.ts` becomes a
  re-export of the new package. `conductor daemon upgrade|releases|rollback` behave exactly as today.
- **Web**: `AppShell` navigation badge, a new `UpdatesSection` in `Settings`, three hooks, one query key.
- **Docs**: `docs/API.md`, PLAN §20 and the README cheat-sheet for the new commands,
  `docs/OPERATIONS.md` for the upgrade path, `docs/design/DESIGN-CONTRACT.md` for the new section,
  `CLAUDE.md`'s repo map for the new package, and an ADR for the schema and package deviations.
- **Unaffected**: the run engine, the wake queue, the dispatcher's own logic, the merge queue, every agent
  tool, worker isolation, the release layout, and the `previous`-symlink rollback mechanism.
