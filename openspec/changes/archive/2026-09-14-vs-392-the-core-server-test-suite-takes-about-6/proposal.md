# Cut `test-core`'s CI wall time by sharding it

Tracker change for [VS-392](weave://tickets/VS-392). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Every merge rebases onto the moved main and re-runs GitHub CI, so `test-core` sets the floor of
the merge queue's throughput. On PR #317 (run 34795872257) the job took **6m20s** of the run,
against `lint` 31s, `typecheck` 1m03s and `test-ui` 3m14s.

The job's step timings say where the time is:

| Step | Time |
|---|---|
| checkout + pnpm + setup-node | 17s |
| `pnpm install --frozen-lockfile` (pf-cache hit) | 5s |
| `npm install -g @fission-ai/openspec@1.12.0` | 4s |
| **`pnpm exec vitest run`** | **5m47s** |

And vitest's own summary says why the run is that long:

```
Duration 345.08s (transform 3.71s, setup 229ms, collect 40.58s, tests 264.31s, environment 36ms, prepare 12.49s)
```

264s of tests plus 40s of collection, all on one core. A standard GitHub-hosted runner for a
private repository reports **2 CPUs**, and vitest's `forks` pool sizes itself as
`max(numCpus - 1, 1)` — one worker. Locally (32 CPUs) the same suite is 176s of tests in a 14.6s
wall. The install and build are not the problem; the suite is running serial in CI because the
runner is small.

## What changes

- **`.github/workflows/ci.yml`.** `test-core` becomes a matrix of **four shards** on four
  runners, each running `pnpm exec vitest run --shard=<n>/4`. A small `test-core` job that
  `needs` the shards keeps the required check name stable: it passes only when every shard did.
- The install, pnpm cache and `openspec` host-tool steps are unchanged; only the suite is split.

## Tests

No test is deleted, skipped or rewritten. Sharding selects the same files and the same tests,
just across four processes instead of one, so the test count is unchanged.

## Out of scope

Rewriting slow tests or fixtures (the profile does not show a single dominant file), changes to
`typecheck`/`test-ui`/`lint`, and GitHub branch protection. The self-hosted runner move is
VS-393.
