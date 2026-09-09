## Why

Captain, 2026-09-09: keep rolling git-build upgrades, and use a git hash as the version instead of 0.1.0. Every upgrade currently reports `v0.1.0 (<sha>)` because `package.json` and `packages/cli/src/program.ts` `VERSION` are hardcoded `0.1.0`. The real identity of a running daemon is the release directory `releases/<YYYYMMDD-HHMMSS>-<sha>/`.

## What Changes

- The primary running-version string (`GET /api/health` `version`, `release.version`, CLI `VERSION`, `conductor --version`) is the git sha of the process's own release directory, not `0.1.0`.
- Human-facing labels that currently print `v0.1.0` (daemon status, doctor, restart/upgrade lines, Login footer, Settings Version row, upgrade announcements) show that sha as the version. The release stamp from the directory name may be shown alongside it. They do not prefix a git sha with `v` as if it were semver.
- When the sha cannot be determined, the version is an explicit unknown sentinel, never a hardcoded package version presented as the running daemon.
- `package.json` versions stay `0.1.0` (npm placeholders). No GitHub Releases, no semver bumps, no change to `upgrade.source` / `upgrade.ref`.

## Capabilities

### New Capabilities

- `daemon-upgrade/running-version`: the running version shown on health, CLI, and UI is the current release's git sha (and stamp when useful), not a hardcoded package version.

### Modified Capabilities

(none — `daemon-upgrade/update-availability` already requires reporting version, commit, and directory; this change defines what the version *is*. `upgrade-surfaces` and `upgrade-announcement` already say "running version" without pinning it to 0.1.0.)

## Impact

- `packages/release` — one resolver for the display sha / unknown fallback, reused by server and CLI.
- `packages/server/src/daemon.ts` `readVersion`, `/api/health`, `release-info.ts` `RunningRelease.version`.
- `packages/server/src/upgrade-announce.ts` `releaseLabel` (stop emitting `v0.1.0 (<sha>)`).
- `packages/cli/src/program.ts` `VERSION`; `commands/daemon.ts` status/restart/update/upgrade lines; `commands/doctor.ts`.
- `packages/ui` Login footer and Settings Version / "now running" rows.
- `docs/API.md` health `version` description.
- Tests: resolver over a fake `releases/<stamp>-<sha>` dir; health/status; announcement label; UI Version row. Existing harnesses that inject `version` keep injecting.
