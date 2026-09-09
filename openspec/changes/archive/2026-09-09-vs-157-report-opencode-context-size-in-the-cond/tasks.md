## 1. Parser records last-request contextTokens

- [x] 1.1 Add `contextTokens: number | null` to `OpenCodeParseState` in
      `packages/runtimes/opencode/src/events.ts`. On each `step_finish` that carries
      `part.tokens`, set it to that step's `input + cache.write + cache.read` (replace, do
      not add). Leave cumulative `usage` accumulation unchanged. If no `tokens` object was
      seen, leave `contextTokens` null (and `usage` null, as today).
- [x] 1.2 In `packages/runtimes/opencode/test/events.test.ts`, assert on `turn-tool-report`
      that `state.contextTokens` is 11_777 (last step) and is less than
      `inputTokens + cachedInputTokens`. Assert on `turn-simple` that it is 11_810 (the one
      request). Assert on `turn-error` that `contextTokens` is null.

## 2. Adapter forwards the field

- [x] 2.1 In `packages/runtimes/opencode/src/adapter.ts`, when `st.usage` is present, spread
      `contextTokens` onto `TurnResult.usage` the same way
      `packages/runtimes/claude/src/adapter.ts` does (omit the key when `contextTokens` is
      null).

## 3. Checks

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (or the opencode package plus
      any suite that would see the new field). All green. Do not launch the real OpenCode CLI.
