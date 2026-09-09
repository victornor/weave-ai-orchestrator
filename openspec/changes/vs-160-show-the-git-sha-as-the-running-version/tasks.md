## 1. Resolver

- [x] 1.1 In `packages/release`, export `releaseVersion(root)` (sha from `releaseSha`, shortened to 10 hex chars when longer; `'unknown'` when sha is null) and `releaseStamp(root)` (the `YYYYMMDD-HHMMSS` prefix of a named release directory, else null). Verify in `packages/release/src/index.test.ts`: a temp dir named `20260909-210807-abc1234def` reports version `abc1234def` and that stamp; a dir with no git and no matching name reports `unknown`.

## 2. Daemon and health

- [x] 2.1 Point `packages/server/src/daemon.ts` `readVersion()` at `releaseVersion(runningReleaseRoot())` instead of `package.json`. Keep `createUpdateChecker({ version })` injectable. Verify a health test against a harness whose `version` and `releaseRoot` are a named release reports that sha as `version` and `release.version`, not `0.1.0`; a root with no recoverable sha reports `unknown`.
- [x] 2.2 Update `docs/API.md` so `GET /api/health` `version` is described as the short git sha of the executing release (unknown when it cannot be determined), not the package version. Verify the paragraph no longer calls `0.1.0` the running version.

## 3. CLI

- [x] 3.1 Set `packages/cli/src/program.ts` `VERSION` from `releaseVersion` of the CLI package root (same `../../..` depth as the server). Verify `conductor --version` (via `buildProgram`) prints that sha, not `0.1.0`.
- [x] 3.2 In `packages/cli/src/commands/daemon.ts` and `doctor.ts`, print health/update/restart/upgrade version without a `v` prefix; include `releaseStamp` on `daemon status` when the release path has one. Verify status/update render tests (or add them) show the sha, not `v0.1.0`.

## 4. Labels and UI

- [x] 4.1 Change `releaseLabel` in `packages/server/src/upgrade-announce.ts` so a git-sha version is not `v`-prefixed and a completed upgrade does not read `v0.1.0 (<sha>)`. Verify `upgrade-announce.test.ts` names the sha; rewrite any assertion that expected `v1.1.0`.
- [x] 4.2 On Login and Settings (Version, now-running, still-running), show the git sha without a `v` prefix; Settings Version MAY append the stamp. Verify `updates.test.tsx` `'shows the running version, commit and release directory'` no longer expects `v1.0.0`, and the Login footer does not render `v0.1.0`.

## 5. Suite

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. All green.
