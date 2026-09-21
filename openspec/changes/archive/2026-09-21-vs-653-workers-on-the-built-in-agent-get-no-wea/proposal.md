## Why

VS-639 was the first ticketed worker on the built-in `weave` runtime. Ten turns produced nothing: the model reports a tool surface of `read`, `grep`, `glob`, `edit`, `write`, `bash`, `task`, `skill` and none of the `weave_*` tools or `submit_result` its prompt tells it to call. It cannot check out, report or ask, so each turn ends empty, is recorded `succeeded`, and the daemon keeps waking it.

Static reading shows the daemon builds the right inputs (`mcp.json` for these runs names the `weave-ai` server and a worker always owes a report, so `outputSchema` is set) and the child adds `submit_result` unconditionally when `outputSchema` is set. So the model's view of its tools does not match what the daemon meant to give it, and nothing on the run records what tools were actually offered. The cause is not established yet; the change therefore makes the tool surface observable and enforced first, then fixes the cause it exposes.

## What Changes

- The child reports the tool names it actually offered (`tools.offered` event on the run, first request of every turn).
- A run that names tools it cannot offer fails at start with a clear `tools_missing` error: when the run carries an `outputSchema`, `submit_result` must be offered; when the run's kind owes the `weave_*` set (workers, weaver, planner), the run-scoped server must have listed those tools. Never silently degrade to a tool-less turn.
- Root cause of the missing tools is found with that evidence (candidates: the child's tool wiring on resumed sessions; the provider's compat `tools` handling and tool-count limits on the codeify provider; a stale build) and fixed. Permissions are not loosened and no tool is added that the worker's kind does not already get.
- An empty turn is not `succeeded`: a worker turn on a run that owed a report and produced neither a report nor evidence on the ticket is recorded with status `failed`, code `empty_turn`, family `tooling`.
- The stall/liveness supervisor stops resuming an agent whose last N (default 2) turns were empty or `empty_turn`: it raises the existing gate finding and does not re-enqueue `liveness_repair` for that ticket until a human or weaver wake arrives.

## Capabilities

### Modified Capabilities
- `builtin-agent`: tool-surface reporting, start guard, and the empty-turn outcome.
- `run-engine` behaviour (liveness, supervisor) is covered by requirements in the same delta because the empty-turn rule lives at the runtime/engine boundary.

## Impact

`packages/agent/src/loop.ts`, `packages/agent/src/protocol.ts`, `packages/runtimes/weave/src/adapter.ts`, `packages/core/src/runs/engine.ts`, `packages/core/src/supervisor/index.ts`, and tests for each. No schema migration expected. End-to-end verification on a real weave-runtime worker ticket needs the owner's codeify key and a live daemon; if it cannot be run from the ticket it is stated as unverified (a fake provider covers the rest).
