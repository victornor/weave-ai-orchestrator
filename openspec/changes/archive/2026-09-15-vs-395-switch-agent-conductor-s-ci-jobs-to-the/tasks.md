# Tasks

- [x] 1. Read VS-394's report rev 3 and action rev 7 and take the exact documented label set; do not guess it.
- [x] 2. `.github/workflows/ci.yml`: switch every job's `runs-on` to
      `[self-hosted, linux, x64, weave-ci]`; collapse VS-392's four `test-core` shards back into one
      `test-core` job; cap vitest's forks at the container's 8-CPU quota (`VITEST_MAX_FORKS=8`); keep
      the required check names `lint`, `typecheck`, `test-core`, `test-ui` and the VS-393 draft guard.
- [x] 3. `docs/PLAN.md` §11.4: note that CI runs on the self-hosted runner, with a pointer to its
      status, logs and removal commands.
- [x] 4. `docs/OPERATIONS.md` §9 "Self-hosted CI runner": what runs where, the label set, resource
      caps, network isolation and the required `--dns`, boot, registration, status/logs/removal, the
      image's added packages and why, benign log noise, accepted risks.
- [x] 5. `README.md`: a short pointer from the development section to that OPERATIONS section.
- [x] 6. Update the project KB document `self-hosted-ci-runner` with the CI switch (what runs on the
      runner, the shard collapse, the fork cap); do not create a second document.
- [x] 7. Add the image's later packages to OPERATIONS.md §9 and the KB doc with their reasons
      (`libatomic1` for `pnpm/action-setup`'s `@pnpm/exe`; `tmux`, `git`, `unzip` and `rsync` for the
      core tests, `rsync` for the git worktree provider's warm copy in `worktrees/git.ts`).
- [x] 8. Prove all four required checks show `success`, not `skipped`, on the PR's final head on
      `weave-ci-01` (`gh api …/commits/<head>/check-runs` and the PR's `statusCheckRollup`), and
      report each job's runner name, labels and duration beside the GitHub-hosted baseline (lint 36s,
      typecheck 48s, test-ui 3m40s, test-core shards 2m07–2m24s; ticket baseline lint ~30s,
      typecheck ~1m, test-ui ~3m15s, test-core ~6m20s).
- [x] 9. `pnpm lint` and `pnpm typecheck` green; take PR #398 out of draft so its own
      `pull_request` run evaluates the landing head, and record the PR work product.