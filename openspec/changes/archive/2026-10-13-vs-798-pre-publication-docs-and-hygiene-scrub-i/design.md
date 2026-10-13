## Decisions

- Toolchain: pick one Node and pnpm and make README, CI, `mise.toml`, Dockerfile and `packageManager` agree; the choice and reason go in the PR. Default: Node 26 / pnpm 11.25.0 (what CI already tests), after checking the Dockerfile builds on it; if no `node:26-slim` image exists, fall back to the newest slim tag CI-compatible and say so.
- Fonts: bundle woff2 latin subsets via `@font-face` in the UI's CSS under `packages/ui`, with OFL texts alongside. Verify by building the UI and loading it in a headless browser with request logging, asserting zero non-origin requests.
- Other-workspace ticket IDs become neutral wording or are dropped; archived changes are edited in place.
- Branch deletion: `weave project prune-branches agent-conductor --dry-run` output is pasted into the PR; the two unmerged branches are deleted last, after merge.
- ADR renumber: `git mv` plus a repo-wide link fix.
