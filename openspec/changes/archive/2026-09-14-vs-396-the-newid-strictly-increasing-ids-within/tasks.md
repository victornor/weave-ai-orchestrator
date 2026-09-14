# Tasks — VS-396

- [x] 1. `packages/db/src/id.test.ts`: freeze the clock with `vi.useFakeTimers()` / `vi.setSystemTime(BASE)` (restore in `afterEach`), keep the strict `ids[i] > ids[i-1]` check for a 64-id batch within the frozen millisecond, and assert each batch's decoded time equals the frozen instant so a test that stopped controlling the clock fails loudly.
- [x] 2. Add a second test that issues a batch at `BASE` and another at `BASE + 1` and asserts strict increase both within each batch and across the millisecond boundary.
- [x] 3. Verify determinism: run `packages/db/src/id.test.ts` 50 times in a loop; all green.
- [x] 4. `pnpm lint`, `pnpm typecheck`, and both suites (`XDG_CONFIG_HOME="$(mktemp -d)" pnpm test`) green; paste both suite blocks verbatim in the report.
