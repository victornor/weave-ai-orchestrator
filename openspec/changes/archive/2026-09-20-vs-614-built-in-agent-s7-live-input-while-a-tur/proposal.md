## Why

The built-in `weave` agent runs a turn, uses tools, resumes sessions and compacts them (S1–S6), but a running turn is closed to the human and cannot report itself: `TurnHandle.send` resolves `unsupported`, so a message sent while a turn runs can only queue behind it or interrupt it instead of steering it, and the turn's final report is recovered by scraping a fenced JSON block out of free text. Captain decided on 2026-09-20 that both workers and the weaver may use this runtime, and live input matters most in the weaver chat, where the human sends a message while a turn runs. S7 closes that gap and adds the two small tools the design already specified: `submit_result` for structured output and `todo_write` for a plan.

## What Changes

- **Live input.** The child keeps reading stdin after `init`; a `send` line queues text that is drained into the session at a request boundary — after the current step's tool results — so the model sees it in the next request. When a step produces no tool calls and the queue is non-empty, the turn continues instead of ending. The adapter's `TurnHandle.send` writes the `send` line while the turn runs and resolves `delivered`; once the child's `result` line has been seen it resolves `closed` without writing.
- **Structured output.** `init` carries the run's `outputSchema`; when it is set the child adds a synthetic `submit_result` tool whose parameters are that schema. A valid call populates `TurnResult.structured` and ends the turn; invalid arguments get a corrective tool result twice, then the turn fails `tool_call_invalid` in family `tooling`. A model that stops without calling it is asked once more, at most twice. The engine carries the schema only for turns that owe a report (a worker, the weaver, a planner, or a session that holds a ticket); a ticketless persistent session is a raw session (VS-618, VS-620) and gets no `submit_result` and no nudge.
- **Todo tool.** `todo_write` replaces the run's todo list, is offered in every permission mode including `restricted`, and emits a `plan.proposed` event carrying the items — the same event the codex runtime emits for its todo list.
- **Capabilities.** The adapter declares `streamingInput: true` and `structuredOutput: true` and forwards the child's `structured` result.
- **Protocol stays v1**: `init.outputSchema` and `result.structured` are additive optional fields.
- Tests at every level with the mock provider; a weaver-kind turn proves a human message sent mid-turn is answered in the same turn.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `builtin-agent`: live input while a turn runs; structured output through a `submit_result` tool; the `todo_write` tool and its plan event; and the adapter surface (streaming input, structured output, `send`). The permission-modes delta also corrects the `restricted` tool list to name `skill`, which the runtime has offered there since S6 while the requirement still listed only `read`, `grep` and `glob`.

## Impact

`packages/agent/src/{protocol,loop,bin,index}.ts`, new `packages/agent/src/{steering,validate}.ts` and `tools/todo.ts`, `packages/agent/src/permission.ts`, `packages/runtimes/weave/src/{adapter,child}.ts`, `packages/core/src/runs/engine.ts` (the report schema is passed only for turns that owe a report), tests in all touched packages, and the design documents in the knowledge base. The engine already routes a live human message to `TurnHandle.send` when the runtime declares `streamingInput` and already prefers `TurnResult.structured` over `extractReport(finalText)`.

## Non-goals

Item-by-item rendering of the todo list in the UI (the transcript already renders the `plan.proposed` line the codex runtime gets, and a todo UI is a UI slice); the `task` subagent and tool-output streaming (S9); approvals, cost display, or any live provider call; `now`-priority send, which is a cancel-and-resume the engine owns. Changing how any runtime other than the built-in agent shapes a turn that owes a report.
