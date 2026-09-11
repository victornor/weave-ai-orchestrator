## 1. Capture fixtures

- [x] 1.1 Add `packages/runtime-sdk/src/fixtures/vs-251-cursor-action-required.txt` containing the
      real cursor `ActionRequiredError` text quoted verbatim in the ticket (the VS-250 failure).
      Verify by reading the file back and diffing against the ticket's quoted text.
- [x] 1.2 Add `packages/runtime-sdk/src/fixtures/codex-youve-hit-your-usage-limit.txt`, a byte-for-
      byte copy of the existing `packages/core/src/runs/fixtures/codex-youve-hit-your-usage-limit.txt`
      (the real VS-238-era codex capture), mirroring the pattern already used for
      `vs-234-opencode.txt`. Verify with `diff` that the two files are identical.
- [x] 1.3 Add `packages/runtime-sdk/src/fixtures/vs-251-claude-usage-limit-reached.txt` containing
      the literal `Usage limit reached` string confirmed present via `strings` on the installed
      Claude Code binary (see design.md's capture notes). Do not invent surrounding sentence text
      that was not actually found.
- [x] 1.4 Run `node scripts/guard-test-fixtures.mjs` (part of `pnpm lint`) and confirm it passes —
      these fixtures live under `packages/`, never under `openspec/changes/`.

## 2. Widen the matcher

- [x] 2.1 In `packages/runtime-sdk/src/process.ts`, add `out of usage` as a new alternative in
      `classifyError`'s quota-matching regex (do not touch any other arm, and do not match on the
      bare word "usage" or on exit code alone, per the ticket's "Do not" section). Verify by hand
      that `classifyError(1, <cursor fixture text>).family === 'provider_quota'`.

## 3. Tests

- [x] 3.1 In `packages/runtime-sdk/src/process.test.ts`, add a test asserting the cursor fixture
      (task 1.1) classifies with `family: 'provider_quota'`, `code: 'provider_quota'`, and a
      `message` that contains the distinguishing phrase from the captured text (acceptance
      criterion 1). Verify with
      `./node_modules/.bin/vitest run packages/runtime-sdk/src/process.test.ts`.
- [x] 3.2 In the same file, add a test asserting the cursor fixture still classifies as
      `provider_quota` when passed a non-1 exit code (e.g. `2`) and again with `exitCode: null`
      (signal exit) — proving the match is exit-code independent, per acceptance criterion 5.
      Verify with the same vitest command; state the finding (exit-code independence) in the ticket
      report regardless of whether a test was needed to prove it.
- [x] 3.3 Add a test asserting the codex fixture (task 1.2) and the claude fixture (task 1.3) each
      classify as `provider_quota`, satisfying acceptance criterion 2 for every runtime whose real
      text could be captured.
- [x] 3.4 Add a regression test asserting a message that only mentions "usage" in passing (e.g.
      `'Usage: cursor-agent [options]\n\nRun with --help for more information.'`) does **not**
      classify as `provider_quota`, per acceptance criterion 3.
- [x] 3.5 Run `./node_modules/.bin/vitest run packages/runtime-sdk/src/process.test.ts` and confirm
      every test in the file (existing and new) passes.

## 4. Full verification and report

- [x] 4.1 Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root. Paste both suite blocks
      (core/server and UI) verbatim into the PR/report with their real totals — never combined,
      never retyped from memory, never claimed as "both passed" above a single block.
- [x] 4.2 Write the ticket report stating: which runtimes now have a captured-bytes fixture and
      test (cursor, codex, claude); that gemini could not be captured without running a live CLI
      against real credentials (forbidden) and what static analysis of the installed gemini CLI
      bundle found instead (see design.md); and the exit-code finding from task 3.2 — the match is
      exit-code independent because `classifyError` only special-cases `exitCode === 0`.
