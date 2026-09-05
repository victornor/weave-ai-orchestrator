# ADR 0008 — The daemon upgrades itself, deferring until no turn is running

Date: 2026-09-05 · Status: accepted

## Context
PLAN §20 makes `conductor daemon upgrade` a human command run from a shell on the daemon host: it builds a release, backs up, `POST /api/daemon/drain`, swings `current`, restarts. Two things are missing for the web app. Nothing tells an operator that an update exists — `deps.version` is the server package's version, not the commit, so it cannot answer "is the source ahead". And the drain is bounded by a timeout and reports what it **interrupted**: turns that were killed at `drainTimeoutSec` and have to resume. VS-28 asks for the opposite posture — wait rather than interrupt — and for both surfaces to reach it.

PLAN §6 enumerates the tables, and `CLAUDE.md`'s repo map enumerates the packages. This change adds one of each.

## Decision

**A new leaf package `packages/release`.** The release-directory helpers (`releases/<stamp>-<sha>`, the `current`/`previous` symlinks, clone-and-build, prune) move verbatim out of `packages/cli/src/release.ts`, which the daemon cannot import. It depends on nothing from `@agent-conductor/*`, so `scripts/guard-boundaries.mjs` needs no new rule, and `packages/cli/src/release.ts` becomes a re-export so no CLI call site changes.

**A new `upgrades` table** (migration `0007`), used in `daemon.sqlite`, with no `workspace_id` and no foreign keys: the daemon is not a workspace. `state` is forward-only through `UPGRADE_STATES`.

**The `current` symlink is the split.** The daemon owns everything before it: holding dispatch, waiting for idle, cloning, building, backing up, swinging. Every failure there is undone by doing nothing — the previous release is still the one running. A **detached runner**, the new release's own CLI, owns the restart, the health check and the rollback, because a process cannot restart itself from inside a request.

**The idle gate is the in-process run count** (`dispatcher.running()` per loaded workspace), never the `runs` table.

## Consequences
- A leaf package costs one line in the repo map and one `tsconfig` reference. The alternatives were worse: duplicating the release layout in `packages/server` is the kind of drift that ends in an unbootable host, and adding `@agent-conductor/core` to the CLI would pull `core`, `db` and `node:sqlite` into the startup path of every `conductor` invocation for six path helpers.
- Gating on the in-process count rather than the `runs` table is deliberate: a row left `running` by a daemon that crashed would otherwise block every future upgrade forever. The cost is that the gate only sees work in *this* process, which is exactly the work a restart would interrupt.
- The record outliving the restart is the only way the outcome is reportable at all — the session that requested the upgrade is gone by the time it succeeds. It also means a stale record could block the next request, so a booting daemon reconciles whatever the last one left: `restarting` on the target becomes `completed`, `restarting` elsewhere past ten minutes becomes `restart_unverified`, anything earlier becomes `abandoned`.
- **Automatic rollback is not universal, and the docs say so rather than implying otherwise.** Restarting a systemd *user* service kills that service's whole control group, so the runner is launched through `systemd-run --user --scope --collect` where that exists; on launchd and on a bare `daemon start` install a plain detached process already survives. On a host with systemd but no `systemd-run` the runner dies with the restart: the record ends `restart_unverified` and `conductor daemon rollback` is the human's. Every pre-swing failure — which is where nearly all of them are — is unaffected.
- The wait for idle is bounded (`upgrade.waitForIdleSec`, default 3600) rather than indefinite. Waiting forever reads the requirement most literally, but one wedged run would then hold every workspace's dispatch silently and without end. On expiry the upgrade fails and dispatch resumes; the record shows what it is waiting for throughout, and it is cancellable the whole time.
- `conductor daemon upgrade` is left exactly as it was. It is the path that works when the daemon is not answering — which is when it is needed most — so the daemon-mediated operations became `conductor daemon update|update apply|update cancel` instead. Two adjacent names is the price; each command's help says which is which.
- `/api/health` now reports the release this process is executing, which is what lets the runner tell whether the daemon that answered is the one it switched to. It is derived from the process, not from `current`, and it never resolves the remote, so the open endpoint reaches no network.
- Every upgrade route is operator-session. `RUN_TOKEN_PATHS` in `packages/server/src/auth.ts` already confines run tokens to `/mcp` and `/api/w/:ws/agent/*`, so an agent cannot upgrade the daemon that is running it — enforced by the existing boundary rather than by a new check.
