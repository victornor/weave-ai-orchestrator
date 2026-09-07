# Tasks

## 1. Carry a per-request context size on the turn result

- [x] 1.1 Add `contextTokens?: number` to `TurnResult.usage` in `packages/runtime-sdk/src/index.ts`,
  documented as the last API request's input + cache-creation + cache-read tokens, omitted by an
  adapter that cannot report per request.
- [x] 1.2 Add the same optional field to `Run['usage']` in `packages/shared/src/types.ts`, so the
  value the engine already writes whole into `runs.usage_json` is typed where clients read it.
- [x] 1.3 Update the `TurnResult` signature in `docs/PLAN.md` §8.1 to match.

## 2. Report it from the Claude adapter

- [x] 2.1 Add `contextTokens: number | null` to `ClaudeParseState`
  (`packages/runtimes/claude/src/events.ts`) and fill it in `assistant()` from `message.usage`:
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, last message wins.
- [x] 2.2 Skip `assistant` messages whose envelope carries a non-null `parent_tool_use_id` — a
  sub-agent's request measures a different conversation.
- [x] 2.3 Leave `result()` as it is: it keeps filling `state.usage` with the turn's cumulative
  counts and emitting `usage.delta` with `basis: 'per_turn'`.
- [x] 2.4 Pass the field through in `adapter.ts`'s returned `usage`, only when known.

## 3. Measure the meter from that field alone

- [x] 3.1 Change `contextTokens()` in `packages/render/src/usage.ts` to read `usage.contextTokens`
  instead of summing `inputTokens + cachedInputTokens`, and rewrite its doc comment and
  `contextStrip`'s to say why the sum is not a context size.
- [x] 3.2 Narrow `contextStrip`'s `usage` input type to the field it now reads, so a caller passing
  only cumulative counts does not typecheck as a context measurement.
- [x] 3.3 Update the comment in `packages/ui/src/routes/Chat.tsx` that describes the size as "the
  last finished turn's input plus cache reads". No behavior change there — the usage object flows
  through whole.

## 4. Tests

- [x] 4.1 Record a fixture (or extend the existing multi-request one) with several `assistant`
  messages of growing context and a cumulative `result` block, and assert in
  `packages/runtimes/claude/test/events.test.ts` that `state.contextTokens` is the **last**
  assistant message's three components summed, while `state.usage` is unchanged from what the test
  asserts today.
- [x] 4.2 Assert in the same suite that an `assistant` message with a `parent_tool_use_id` does not
  move `contextTokens`.
- [x] 4.3 In `packages/render/src/usage.test.ts`, update the `contextStrip` cases to the new field
  and add a regression case: a realistic multi-request turn (cumulative counts far over the window,
  `contextTokens` inside it) reports the real percentage and cannot exceed 100 %.
- [x] 4.4 Add a case asserting that usage carrying only cumulative counts yields
  `reason: 'Context size unreported'` and no meter.
- [x] 4.5 Update `packages/ui/src/test/contextMeter.test.tsx` for the new input shape.

## 5. Verify and deliver

- [x] 5.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` green (root `pnpm test` stops before the ui
  suite when the core run is red — run the ui filter separately as well).
- [x] 5.2 In the PR, state the old and new readings for a concrete turn using the recorded fixture,
  and note that runs finished before this change carry no per-request figure, so their meters read
  "Context size unreported" until the conductor next finishes a turn on the upgraded daemon.
