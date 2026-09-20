## 1. Live input while a turn runs

- [x] 1.1 Add `packages/agent/src/steering.ts` with a `SteeringQueue` (`push(text)`, `drain(): string[]`, order preserved, drain empties) exported from `index.ts`; verify with a unit test.
- [x] 1.2 In `loop.ts`, accept the queue through `LoopDeps`, drain it into the session as user messages at the top of each step (after the previous step's tool results), and continue instead of returning when a no-tool-call step has queued text; verify with mock-provider loop tests that the next request body carries the text after the tool result and that the turn's final text answers it.
- [x] 1.3 In `bin.ts`, push every `send` line read after `init` into the queue; verify with a `bin.test.ts` case that writes a `send` line while the first request streams and asserts the next recorded request body contains the text.
- [x] 1.4 Give the adapter's `TurnHandle.send` a real implementation over `spawnLines.write`, returning `delivered` while the turn runs and `closed` once a result was seen or the spawn ended; verify with an adapter test against `fake-agent.mjs` (extend it to hold a turn open and record received `send` lines).

## 2. Structured output

- [x] 2.1 Add `outputSchema` to `InitMessage` and `structured` to `ChildResult` in `protocol.ts`, and pass `input.outputSchema` through `buildInit` in `child.ts`; verify an adapter test records the schema in the fake agent's `init` and forwards a `structured` result.
- [x] 2.2 Add a dependency-free JSON-Schema subset validator (`packages/agent/src/validate.ts`: `type` incl. arrays, `enum`, `required`, `properties`, `additionalProperties: false`, `items`; unknown keywords ignored) with unit tests, including the report schema accepting a valid report and naming each violation.
- [x] 2.3 In `loop.ts`, add the synthetic `submit_result` tool when `outputSchema` is set (offered in every mode and regardless of allow lists), populate `structured` and end the turn on a valid call with a persisted tool result, return a corrective result for the first two invalid calls then fail `tooling`/`tool_call_invalid` on the third, and nudge at most twice when the model stops without submitting; verify with mock-provider loop tests for the valid, three-invalid and nudge paths.
- [x] 2.4 Declare `structuredOutput: true` on the adapter and update the declaration test.

## 3. Todo tool

- [x] 3.1 Add `packages/agent/src/tools/todo.ts` (schema per the design) and wire it into the loop's core tool set and `RESTRICTED_CORE_TOOLS`, replacing a loop-scoped list and emitting `plan.proposed` with the items; verify with tests that a second call replaces the first list, the event carries the items, and a `restricted` request body offers `todo_write`.
- [x] 3.2 Label a `plan.proposed` that carries todo items as a todo update in `packages/render` and `packages/ui`, leaving a real plan proposal as "waiting for approval" and codex's emitted event unchanged (the conductor's build note); verify with render and UI transcript tests.

## 4. Weaver scale, docs and verification

- [x] 4.1 Add a weaver-kind loop test (`weaver.loop.test.ts`): a human message delivered mid-turn is answered in the same turn, appears in the next request after the tool result, and leaves a valid history.
- [x] 4.2 Update the knowledge-base design docs to match what was built: `builtin-agent-live-input` (new, supersedes the live-input/todo/permission specifics of `builtin-agent-runtime-details`) plus the S7 decision in `builtin-agent-slices`.
- [x] 4.3 Run `pnpm lint`, `pnpm typecheck`, then one full suite once at the end with `--maxWorkers=4`; paste both suite blocks verbatim in the report.

## 5. Merge-card concerns (rebase + report gate)

- [x] 5.1 Carry the report schema only for turns that owe one (`packages/core/src/runs/engine.ts`: `ticket !== null || kind !== 'session'`), keep the weave adapter/child free of ticket knowledge, and add tests: a ticketless session turn has no `outputSchema` while a ticketed session and the weaver do; a weave turn with no schema offers no `submit_result` and is never nudged.
- [x] 5.2 Rebase onto current main, resolve conflicts, re-run `pnpm lint`, `pnpm typecheck` and one full suite (`--maxWorkers=4`), push and re-request landing.
