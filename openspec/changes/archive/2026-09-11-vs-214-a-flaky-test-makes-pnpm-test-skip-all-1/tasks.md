## 1. Always run both test suites

- [x] 1.1 Replace the root `package.json` `test` script (`vitest run && pnpm --filter @agent-conductor/ui test`) with `node scripts/test.mjs`. The runner prints a named header for the core/server suite, runs `vitest run`, prints a named header for the UI suite, runs `pnpm --filter @agent-conductor/ui test`, then exits non-zero if either failed and prints `FAILED: <name> suite` for each red suite. Do not swallow a failure. Verify: invoke the runner in a way that makes the first suite fail and confirm the UI suite still executes and the process exits non-zero with the failed suite named.

## 2. Isolate the upgrade rollback test from the host `current` symlink

- [x] 2.1 In `packages/server/test/upgrade.test.ts`, point `XDG_DATA_HOME` at a temp dir whose `agent-conductor/current` is a symlink to the fixture from-release (`/rel/20260101-120000-aaaaaaaaaa`) for every test, and restore the previous env value in `afterEach`. Keep asserting that a failed runner start switches to the built release and then back to the previous current (same behaviour; not skipped, retried, or loosened). Verify: `XDG_DATA_HOME=/tmp/ac-no-current-$RANDOM npx vitest run packages/server/test/upgrade.test.ts -t "puts \`current\` back"` passes (it failed with length 1 before this isolation).

## 3. Confirm determinism and siblings

- [x] 3.1 Run `packages/server/test/upgrade.test.ts` alone 20 consecutive times, all green. Verify: a one-line shell loop, all 20 pass.
- [x] 3.2 Sibling check: `jobs.test.ts` "lists a project's jobs newest first" is not this flake (5/5, no `currentLink()`/`stamp()`). `engine.test.ts` "third consecutive authentication failure" is a different race — guessed `setImmediate` after `runOnce()` — reproduced 1/5 before the fix. Wait for the auth-failure run count with `until()` instead; 20/20 after. Assertions unchanged.
- [x] 3.3 `pnpm lint && pnpm typecheck && pnpm test` green. Post the actual output.
