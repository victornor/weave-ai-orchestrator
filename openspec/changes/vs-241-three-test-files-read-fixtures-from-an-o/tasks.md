# Tasks

## 1. Move the captures into package fixtures

- [x] 1.1 Add `packages/core/src/runs/fixtures/` holding byte-identical copies of `vs-234-opencode.txt`, `claude-monthly-spend-limit.txt` and `codex-youve-hit-your-usage-limit.txt`, and `packages/runtime-sdk/src/fixtures/vs-234-opencode.txt`. Copy them from `openspec/changes/archive/2026-09-11-vs-238-a-worker-parked-on-an-exhausted-quota-ca/captures/`. Verify: `cmp` reports every fixture identical to its archived original.

- [x] 1.2 Point the three tests at the fixture directories: `packages/core/src/runs/reset.test.ts`, `packages/core/src/runs/engine.test.ts` and `packages/runtime-sdk/src/process.test.ts`. Change fixture paths only — no assertion, no parser, no behavior change. Verify: each of the three files passes in isolation, including the `2026-09-11T17:54:35Z` VS-234 reset assertion.

## 2. Make the guarantee structural

- [x] 2.1 Add `scripts/guard-test-fixtures.mjs`, which fails if any `*.test.ts` / `*.test.tsx` under `packages/` reaches a path into `openspec/changes/`, and add it to the root `lint` script. Verify: `pnpm lint` is green on the fixed tree, and non-zero (naming the file) when the old `openspec/changes/` path is temporarily put back.

## 3. Verification and delivery

- [x] 3.1 `pnpm lint && pnpm typecheck` green.

- [x] 3.2 Full `pnpm test` green; paste both suite blocks verbatim (core/server and UI, real totals, never summed), stating that the three previously failing files are among the passes.

- [x] 3.3 Commit with the ticket id, deliver per delivery.md, transition to `in_review`.
