# Tasks

- [x] 1. Add `.github/workflows/ci.yml` with `pull_request` and `push: branches: [main]`, a per-ref `concurrency` group with `cancel-in-progress: true`, and four separate `ubuntu-latest` jobs — `lint`, `typecheck`, `test-core`, `test-ui` — each with its own `timeout-minutes`, installing with `pnpm install --frozen-lockfile` and the pnpm store cached.
- [x] 2. Resolve Node and pnpm from the repo's own pins without adding or changing one: `pnpm/action-setup` reads `packageManager` (`pnpm@11.25.0`); `actions/setup-node` pins Node `26` matching `mise.toml`, with a comment saying so.
- [x] 3. Confirm neither test job needs a prior build (vitest aliases every package to source) and record that fact — build only what is actually needed, if anything.
- [x] 4. Push the branch and confirm all four jobs are green on the PR's own workflow run; fix any test that fails only in CI at its source (seam fake or `skipIf` naming the absent host tool), never by deleting or blanket-skipping it. Found and fixed a real unhandled EPIPE in `runCommand` (VS-329).
- [x] 5. PR description links the green run (`gh run view`) and lists each job's duration; note branch protection/required checks as a captain-owned option.
