## 1. Thread the home-rerender signal into the turn prompt

- [x] 1.1 Add `homeRerendered?: boolean` to `TurnPromptOptions` in `packages/core/src/prompts/index.ts`, and forward `ensureHomeCurrent`'s `rerendered` result onto `promptOptions.homeRerendered` in `packages/core/src/runs/engine.ts`'s `prepare_home` phase, next to the existing `briefUpdated`/`charterChanged` forwarding. Verify with `pnpm typecheck`.

## 2. Change the digest-paste condition

- [x] 2.1 In `buildTurnPrompt`, change the worker exclusion from `agent.kind !== 'worker'` to `agent.kind !== 'worker' || (opts.sessionStale && !opts.homeRerendered)`, and update the adjoining comment to explain why (points at the `worker-prompt/dedup` delta's reasoning, not a restatement). Verify by reading the diff: the conductor branch of the condition is untouched.

## 3. Tests

- [x] 3.1 In `packages/core/src/prompts/render.test.ts`, add a case asserting a worker's stale-session prompt (`sessionStale: true, homeRerendered: false`) contains the bootstrap digest text and still records bootstrap usage. Verify with `pnpm vitest run packages/core/src/prompts/render.test.ts`.
- [x] 3.2 In the same file, add a case asserting a worker's stale-session prompt with `homeRerendered: true` does NOT contain the digest text (no duplication when the home was just refreshed), and still records bootstrap usage. Verify with the same command.
- [x] 3.3 Confirm the existing VS-161 tests (`records worker bootstrap without pasting it into the first-turn prompt`, `still pastes the bootstrap digest into the conductor first-turn prompt`) still pass unmodified. Verify with the same command.

## 4. Wording

- [x] 4.1 Tighten `templates/brief.md.tmpl`'s `ac_knowledge_get("project")`/`ac_knowledge_get("shared")` lines so "already injected" describes what actually happens (inlined in `AGENTS.md` at render time; refreshed rather than re-pasted on a stale session), matching for both lines. Verify by reading the rendered brief in a test or by eye.

## 5. Full verification

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (both suites) and paste both suite blocks verbatim with their real totals in the delivery report.
