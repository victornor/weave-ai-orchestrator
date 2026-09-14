# Tasks — VS-392

- [x] 1. Profile `test-core`: step timings from the GitHub Actions run and vitest's
  collect/tests split, plus the slowest test files.
- [x] 2. Shard the core/server suite across four parallel jobs in `.github/workflows/ci.yml`,
  keeping a single `test-core` check that depends on all shards.
- [x] 3. Run `pnpm lint`, `pnpm typecheck` and both test suites locally and paste both suite
  blocks on the ticket.
- [x] 4. Push the branch, capture the new `test-core` CI timings, and record the before/after
  numbers on the ticket.
