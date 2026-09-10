## 1. Freeze time in the three affected tests

- [x] 1.1 In `packages/core/src/usage/usage.test.ts`'s `usage top / models / ticket` describe block, freeze the clock in the three tests that use `nowIso()` + `window: '24h'` (`groups by model and ticket with human labels, ordered by cost`, `groups ticket-less usage per agent instead of one unknown bucket`, `aggregates per model with provider`): `vi.useFakeTimers(); vi.setSystemTime(<fixed instant>)` before inserting rows, capture `when = nowIso()` at that frozen instant, then `vi.setSystemTime(<fixed instant + 1000ms>)` before calling `usage().top()`/`usage().models()`, so the query's internal `new Date()` is always deterministically after every row's `occurred_at`. Add `vi.useRealTimers()` to the file's existing `afterEach` alongside `h?.cleanup()`. No assertion changes. Verify: `npx vitest run packages/core/src/usage/usage.test.ts` passes.

## 2. Confirm determinism

- [x] 2.1 Run `packages/core/src/usage/usage.test.ts` alone, 20 consecutive times, all green (no retry/skip/only/timeout-increase used anywhere). Verify: a one-line shell loop, all 20 runs pass.
- [x] 2.2 Run the full test suite (`pnpm test`) 3 consecutive times, all green. Verify: 3 consecutive clean runs.
- [x] 2.3 Run `pnpm lint && pnpm typecheck` clean. Verify: both exit 0.
