# Tasks

## 1. The shim module (`@weave-ai/release`)

- [x] 1.1 Add `packages/release/src/shim.ts`: `userBinDir(home)`, `cliShimTarget(dataHomeDir)`,
      `renderCliShim({ target, node, deprecated })` (comment says `Weave AI CLI` and
      `weave daemon upgrade`), `readCliShimTarget(content)`, and `writeCliShims({ home, dataHomeDir,
      node })`. The writer puts `weave` at `<home>/.local/bin/weave` pointing at
      `<dataHomeDir>/current/packages/cli/dist/bin.js`; it rewrites that file only when its bytes
      change, rewrites an existing `<home>/.local/bin/conductor` that is already a Weave shim (adding
      the stderr deprecation notice), never creates `conductor`, and does nothing when the current
      release's CLI bin is absent. Export it from `index.ts`.
- [x] 1.2 Unit-test it in `packages/release/src/shim.test.ts` with temp directories: fresh write,
      idempotent no-op, conductor rewrite (loses no target, gains the notice), no conductor created,
      nothing written without a release.

## 2. Install and upgrade write it

- [x] 2.1 `packages/cli/src/daemon.ts`: `installService()` and `installLaunchdAgent()` call the
      writer for this machine.
- [x] 2.2 `packages/cli/src/commands/daemon.ts`: `weave daemon upgrade` writes the shim after
      `switchRelease`.
- [x] 2.3 `packages/server/src/upgrade.ts`: add a `writeShims` seam (default the real writer) to
      `UpgradeDeps`, called after a successful deferred switch; stub it in
      `packages/server/test/upgrade.test.ts` and `upgrade-announce.test.ts` fixtures so no test
      writes into the real home.
- [x] 2.4 Extend `packages/cli/src/daemon.test.ts` to prove `installService` writes the `weave`
      shim at a temp `HOME`/`XDG_DATA_HOME` and rewrites an existing `conductor`, touching neither the
      real home nor the real config.

## 3. `weave doctor`

- [x] 3.1 Add a check to `packages/cli/src/commands/doctor.ts`: a missing `weave` shim, or one whose
      target is not the current release's CLI bin, fails with the command that fixes it; a correct
      one passes. Add a test in `packages/cli/src/doctor-command.test.ts` with a temp home.

## 4. Drop the leftover `conductor` argument spellings

- [x] 4.1 `packages/cli/src/commands/models.ts` and `packages/cli/src/commands/daemon.ts`: `weaver`
      is the control name shown and documented (`models set|inherit`, `daemon models set`, the
      `models show` / `daemon models show` label); `conductor` stays accepted and warns once on
      stderr. Update the `program.test.ts` expectations that assert the old label/spelling.

## 5. Docs

- [x] 5.1 `README.md`: the install section says install/upgrade write `~/.local/bin/weave`; mention
      that `conductor` remains as a deprecated alias; keep the `pnpm link`/wrapper option.
- [x] 5.2 `docs/OPERATIONS.md` §1: same, one line.

## 6. Verify

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck` and both suites; paste both suite blocks verbatim in the
      delivery comment.
