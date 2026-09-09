## Why

VS-98 made the conductor-chat context meter read `usage.contextTokens` — the size of the turn's
**last** API request — and left every runtime other than Claude omitting that field. An absent
value reaches `contextStrip` as 0, which is the existing "Context size unreported" line. Captain
on 2026-09-09: "Seems like we got a context size unreported when we use OpenCode."

The chat is working as designed. The OpenCode adapter (`packages/runtimes/opencode/src/events.ts`)
already walks every `step_finish` and sums `part.tokens` into cumulative `inputTokens` /
`outputTokens` / `cachedInputTokens`, but never writes `contextTokens`. Each `step_finish` *is*
one request: `tokens.input`, `tokens.cache.write` and `tokens.cache.read` are that request's
fill of the window, the same three numbers Claude sums from an `assistant` usage block. The
fixture `turn-tool-report.jsonl` (opencode 1.18.27) has two steps whose last-request size is
11,777 tokens while the cumulative totals the adapter already records are 4,551 + 18,944 — so
feeding the totals to the meter would be the VS-98 bug again. The last step's own figures are
the missing field.

## What Changes

- **The OpenCode parser records `contextTokens` as the last `step_finish` that carried a
  `tokens` object:** `input + cache.write + cache.read`. Last wins, not a maximum and not a
  sum. Cumulative `usage` keeps accumulating every step, unchanged, including still ignoring
  `cache.write` (pre-existing; not this ticket).
- **The adapter forwards the field** on `TurnResult.usage` the same way Claude does, so
  `finalize()` writes it into `runs.usage_json` and `GET /conductor`'s `lastRun` already carries
  it to `contextStrip`. No engine, route, render or UI change.
- **No tokens object in the stream → omit `contextTokens`.** The error fixture has none; the
  meter stays on "Context size unreported" rather than treating the cumulative total as a size.
- **Tests on the recorded multi-step fixture** assert last-request vs cumulative, plus omit-when-
  absent. No live `opencode` invocation (credential rotation rule).

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `conductor-chat/session-limit`: a new requirement that OpenCode's turn result carries the
  last-request size whenever the CLI reported per-request tokens, so the existing header meter
  (already specified to read only `contextTokens`) shows a size and a window instead of
  "Context size unreported".

## Impact

- `packages/runtimes/opencode/src/events.ts` — `OpenCodeParseState.contextTokens`, filled on
  `step_finish`.
- `packages/runtimes/opencode/src/adapter.ts` — pass it through on the turn result.
- Tests: `packages/runtimes/opencode/test/events.test.ts` (and the existing
  `fixtures/turn-*.jsonl`).
- No change to `packages/render`, `packages/ui`, Claude, Gemini, Codex, or `docs/PLAN.md`
  (the `contextTokens` field already exists).

## Out of scope

- Gemini / Codex / Cursor context meters.
- Changing `contextStrip` or the Claude path.
- Inventing a size when the CLI does not report one.
- Declaring `contextWindowTokens` on OpenCode models (VS-129 left them omitted; a missing
  window with a known size is already a specified meter path).
- Changing how cumulative `usage` treats `cache.write`.
