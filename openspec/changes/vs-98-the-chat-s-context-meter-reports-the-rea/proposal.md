## Why

VS-78 put a context meter in the conductor chat header, and it reads 100% for almost every turn.
The workspace owner said so on 2026-09-07: "the conductor chat shows 100% compaction, but I think
that's wrong". It is wrong, and not by a little.

`contextStrip` (`packages/render/src/usage.ts:244`) measures context as the run's
`inputTokens + cachedInputTokens`, and its comment states the intent correctly — "what the last turn
sent, plus what it read from cache". But the number it reads is not one request. The Claude adapter
takes its usage block off the CLI's terminal `result` message
(`packages/runtimes/claude/src/events.ts:136`), and that block is **cumulative across every API
request the turn made**: in the recorded fixture `turn-tool-structured.jsonl` the two requests'
`cache_creation_input_tokens` of 17,739 and 205 arrive in the `result` block as their sum, 17,944,
so the meter measures 35,701 tokens for a turn whose largest request was 17,952. A turn with twenty
tool round-trips re-sends or
cache-reads the whole conversation twenty times, so the recorded sum is roughly
(context size × requests). Two conductor runs recorded in this workspace on 2026-09-07 came to
987,790 and 1,041,773 tokens against a 200,000 window — 494% and 521%, both clamped to 100%.

Both numbers are wanted, and they are different numbers. Cost, the usage view and the plan-limit
strip need every token the turn consumed; the meter needs the size of one request. Today one field
is asked to be both, so the meter is the one that is wrong.

## What Changes

- **A run records the size of its last API request, separately from the turn's cumulative usage.**
  `TurnResult.usage` gains an optional `contextTokens` — the last request's
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. The existing
  `inputTokens` / `cachedInputTokens` / `outputTokens` keep meaning exactly what they mean now, so
  nothing about cost, `usage_events` or the plan-limit strip moves.
- **The Claude adapter reads it from the streamed `assistant` messages**, each of which carries the
  usage of the request that produced it, keeping the last one seen. Messages nested under a
  sub-agent (`parent_tool_use_id` set) are ignored: their context is a different conversation's.
  The terminal `result` message keeps feeding the cumulative figure, unchanged.
- **The meter reads only that field.** `contextTokens()` and `contextStrip()` stop summing
  `inputTokens + cachedInputTokens`; a run whose usage carries no `contextTokens` shows the existing
  "Context size unreported" line rather than a wrong percentage.
- **The other three runtimes are left reporting nothing per request**, so their agents' meters say
  "Context size unreported" — honest, and the same line an unreported turn already gets. Codex,
  Gemini and OpenCode all parse a single cumulative usage block; giving each one a per-request
  reading is separate work, per runtime, and is not attempted here.
- **No storage change.** `runs.usage_json` is written whole from `TurnResult.usage`, so the new
  field reaches `GET /conductor`'s `lastRun` and the chat with no migration and no route change.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `conductor-chat/session-limit`: the context requirement changes what the measured number *is* —
  the last API request of the last finished turn, as the runtime reported it per request, rather
  than the turn's total input plus cache reads — and states that the cumulative figure the same turn
  records for cost is untouched. The "cannot honestly measure" requirement gains the case of a
  runtime that reports only cumulative usage, which shows the same quiet line as a turn that
  reported nothing.

## Impact

- `packages/runtime-sdk/src/index.ts` — `TurnResult.usage.contextTokens?`.
- `packages/runtimes/claude/src/events.ts` — `ClaudeParseState.contextTokens`, filled in
  `assistant()`; `packages/runtimes/claude/src/adapter.ts` — passing it through on the result.
- `packages/shared/src/types.ts` — `Run['usage'].contextTokens?`.
- `packages/render/src/usage.ts` — `contextTokens()` and `contextStrip()` read the new field.
- `packages/ui/src/routes/Chat.tsx` — comment only; the usage object already flows through whole.
- `docs/PLAN.md` §8.1 — the `TurnResult` signature.
- Tests: `packages/runtimes/claude/test/events.test.ts` (+ a multi-request fixture),
  `packages/render/src/usage.test.ts`, `packages/ui/src/test/contextMeter.test.tsx`.

## Out of scope

- The 200,000-token window constant and the 0.92 compaction fraction: unchanged.
- The plan-limit strip beside the meter, and anything about how usage is billed or costed.
- Per-request usage for the Codex, Gemini and OpenCode adapters.
- Showing the context meter for workers, or anywhere other than the conductor chat header.
