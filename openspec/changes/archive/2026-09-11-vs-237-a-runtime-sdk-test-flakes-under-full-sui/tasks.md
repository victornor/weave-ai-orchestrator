## 1. Wait for the echo, not a 50ms sleep

- [x] 1.1 In `packages/runtime-sdk/src/process.test.ts` `"open mode keeps stdin writable"`, replace both fixed 50ms sleeps with `vi.waitFor` on the expected `onLine` stdout (`echo:first`, then after the second write `echo:first` + `echo:second`). Assert each `write()` returns `true`. Do not introduce a retry plugin or widen a sleep. Verify: the file is green in isolation; the two sibling tests in this file still wait on `run.done` and are unchanged in mechanism.

- [x] 1.2 Re-run the load reproduction that produced 21/128 failures of the 50ms assertion (concurrent `spawnLines` open-mode round-trips under process-spawn churn). Verify: the same wait-for-echo sequence records 0 failures across a comparable batch.

## 2. Verification and delivery

- [x] 2.1 `pnpm lint && pnpm typecheck` green.

- [x] 2.2 Full `pnpm test` green; paste both suite blocks verbatim (core/server and UI, real totals, never summed).

- [x] 2.3 Commit with the ticket id, deliver per delivery.md, transition to `in_review`.
