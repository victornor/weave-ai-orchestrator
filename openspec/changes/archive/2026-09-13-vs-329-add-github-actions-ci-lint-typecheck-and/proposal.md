# CI runs lint, typecheck and both test suites on every pull request and push to main

Tracker change for [VS-329](weave://tickets/VS-329). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

`victornor/agent-conductor` has no `.github/workflows`. The last three merged PRs (#268–#270)
have zero check runs, so a red suite is only caught if a worker happens to run it locally. The
local gate (`scripts/test.mjs`) is real, but nothing enforces it at the forge.

Captain wants CI on this repo, partly so the board's new PR-checks line (VS-328) has something
real to show on our own project.

## What changes

- **`.github/workflows/ci.yml`.** Runs on `pull_request` and on `push` to `main`. Four separate
  jobs so each is its own check: `lint` (`pnpm lint`), `typecheck` (`pnpm typecheck`),
  `test-core` (`pnpm exec vitest run`) and `test-ui` (`pnpm --filter @weave-ai/ui test`).
- **Toolchain from the repo's own pins.** Node from `mise.toml` (`26`) and pnpm from
  `package.json`'s `packageManager` (`pnpm@11.25.0`) via `pnpm/action-setup`, which reads that
  field. No pin is added or changed.
- **Lean.** `pnpm install --frozen-lockfile`, the pnpm store cached through
  `actions/setup-node`'s `cache: pnpm`, `concurrency` with `cancel-in-progress` per ref,
  `timeout-minutes` per job, and `ubuntu-latest`.
- **No build step.** Both vitest configs alias `@weave-ai/*` onto each package's source, so the
  suites need no prior `pnpm build`; `pnpm typecheck` runs `tsc -b` itself.

`scripts/test.mjs` is unchanged and stays the local gate.

## Tests that only fail in CI

A GitHub runner has no `systemctl --user` session, no `openspec` and no user `gh` login. The
suite already fakes each of these (an injected `io` host, `AC_OPENSPEC_BIN` pointed at a temp
binary, a fake `gh` on `PATH`), so the first run is expected to be green. Any test that turns
out to fail only on the runner is fixed at its source — a seam fake or a `skipIf` naming the
missing host tool — never deleted or blanket-skipped. A genuine timing flake is named in the PR
description with its failing output.

## Out of scope

Branch protection and required status checks (a captain-owned repo setting, offered as an
option in the PR); deploy, release and publish workflows; coverage uploads and badges.
