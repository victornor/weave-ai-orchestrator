## Context

See `proposal.md` for motivation. Today:

- `packages/server/src/daemon.ts` `readVersion()` returns `packages/server/package.json` `version` (`0.1.0`).
- `packages/cli/src/program.ts` `VERSION` is the string `'0.1.0'`.
- `releaseSha(root)` (`packages/release`) already recovers the commit from the process's release directory (clone HEAD, else `<stamp>-<sha>` name). `describeRelease` puts that in `release.sha` and still takes `version` as a separate argument, so health reports `{ version: "0.1.0", release: { version: "0.1.0", path, sha } }`.
- Human labels prefix `v` + that version: Settings `v${running.version}`, Login `v${health.version}`, `releaseLabel` → `v0.1.0 (abc1234)`, daemon status/doctor/restart/update the same.
- Upgrade identity and comparison already use `release.path` / `release.sha` (`onTarget` in the restart runner). Unchanged.

Release dirs are `releases/<YYYYMMDD-HHMMSS>-<sha>/` with sha from `git rev-parse --short=10`.

## Goals / Non-Goals

**Goals:**

- One resolver both processes call: version string = short sha of *this process's* release root, or `unknown`.
- Health, CLI `--version`, and every listed operator label use it; git shas are not `v`-prefixed.
- Tests cover the resolver and health/status reading a fake named release; existing injected-version harnesses keep injecting.

**Non-Goals:**

- No `package.json` version bumps, GitHub Releases, or semver.
- No change to `upgrade.source` / `upgrade.ref`, update comparison, or `onTarget` (still path or full sha).
- Not reading the `current` symlink for identity (same trap `runningReleaseRoot` already documents).
- Not removing the Settings Commit or Release rows; Version stops duplicating `0.1.0`.
- Not changing MCP/OpenAPI `info.version` semantics beyond it inheriting the same string (they already take `deps.version`).

## Decisions

**Resolver lives in `@agent-conductor/release`.** Export `releaseVersion(root): string` next to `releaseSha`. Prefer `releaseSha`; if the recovered commit is longer than 10 hex chars, slice to 10 to match `buildRelease`. If sha is null, return `'unknown'`. Optional `releaseStamp(root): string | null` parses `^(\d{8}-\d{6})-` from the basename for labels that want it.
- Alternative: keep reading `package.json` and only change displays to `release.sha`. Rejected — health `version`, CLI `--version`, and `cameBackVersion` would still be `0.1.0`, which is what the ticket calls the primary version.
- Alternative: put the full 40-char sha in `version`. Rejected — noisy on Login/status; the full commit stays in `release.sha` for comparison.

**Daemon `readVersion()` and CLI `VERSION` both call `releaseVersion` on their package root** (`resolve(here, '..', '..', '..')` from `packages/server/dist` and `packages/cli/dist`, same depth `runningReleaseRoot` already uses). CLI already depends on `@agent-conductor/release`.
- Alternative: bake the sha in at `pnpm build`. Rejected — a checkout and a release dir already answer via git / directory name; a build stamp is another source of truth.

**Human labels: no `v` prefix on a sha.** `releaseLabel` uses the version string (or short sha if version is unknown) without `v`. Daemon status Version field, doctor daemon line, restart/upgrade outcome, Login footer, Settings Version / now-running / still-running drop the `v` prefix. Stamp may be appended on status and Settings (`<sha> · <stamp>`), not on the one-line announcement (already names the sha).
- Alternative: keep `v` + sha (`vabc1234def`). Rejected — `v` means semver here.

**Harnesses that pass `version:` keep passing it.** `makeHarness` / `createUpdateChecker({ version })` stay injectable so unit tests do not depend on the worktree's HEAD. New tests exercise `releaseVersion` / health against a temp dir named `20260909-210807-abc1234def`.

**Docs:** `docs/API.md` health `version` is the short git sha of the executing release, not the package version. `package.json` files stay `0.1.0`.

## Risks / Trade-offs

- [A CLI from a checkout talking to a released daemon prints different `--version` than `daemon status`] → Accepted. `--version` is the binary; status is the daemon. They already could diverge.
- [Tests asserting `v1.0.0` / `v0.1.0-test` on labels break] → Rewrite those assertions to sha-shaped versions; harnesses that only check JSON `version` keep injecting.
- [`cameBackVersion` stored on old upgrade rows is `0.1.0`] → Historical rows stay as stored; new upgrades store the sha. No migration.
- [OpenAPI / MCP advertise the sha as `info.version`] → Fine; they already used `deps.version`.

## Migration Plan

No data migration. After deploy, the next boot of a release reports that release's sha. Rollback is the previous release (which still reports `0.1.0` until this lands).

## Open Questions

None.
