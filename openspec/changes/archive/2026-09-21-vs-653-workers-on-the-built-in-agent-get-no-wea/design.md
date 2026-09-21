## Context

Findings so far (2026-09-21, read from the repo and the runs' `events.jsonl`/`mcp.json`, no runtime launched):
- Engine (`engine.ts`) always puts the run-scoped `weave-ai` MCP server in `input.mcpServers` and sets `outputSchema` for any worker turn; `mcp.json` of the VS-639 runs confirms the server entry.
- Child (`loop.ts`) connects the Weave server first and throws `mcp_unavailable` if it is unreachable, lists tools, and adds `submit_result` after filters whenever `init.outputSchema` exists.
- The model of those runs says its tools are the eight core tools plus `skill`. Either the child offered exactly that (contradicting the code above, so the running build or the wire differs) or the provider path dropped/ignored the extra tools. Nothing in the run's events records which.
- A run with liveness `empty` is stored `succeeded` by design (`classifyLiveness`); the only consequence is a gate finding after three of them (`engine.ts`). `livenessScan` re-enqueues `liveness_repair` for a ticket in an acting status each scan, and the live-input path delivers further wakes into the running child, which the model read as its own tool results being "replaced".

## Decisions

1. **Observe first.** The child emits `tools.offered {names, weaveServerTools, submitResult}` on the first request of a turn. Cheap, run-visible, and it turns the next failure into a diagnosis.
2. **Enforce at start, in the child.** After tool assembly, if `outputSchema` is set and `submit_result` is absent, or the run's `permission`/kind demands the Weave set and the Weave server listed zero tools, the child ends the turn with `tooling/tools_missing` and a message naming what is missing. The adapter maps it like any other child error. Chosen over a daemon-side check because only the child knows what it built.
3. **Root cause after evidence.** Task list has a reproduction step with a scripted fake provider (no live credentials) that replays a worker init through the loop and asserts the request body's `tools`; then a codec check for `compat.tools` and provider tool limits using the codeify profile shape. The fix goes where it points. If it needs facts only the live provider can give, it goes back to the weaver as a concern rather than a guess.
4. **Empty is not success.** Engine: a worker turn whose run owed a report, returned no report and left no ticket evidence (`runProducedEvidence`) finishes `failed` with `empty_turn`. Existing retry ladders must not treat it as transient.
5. **Bounded resume.** Empty/`empty_turn` count of 2 consecutive stops `liveness_repair` enqueues for that agent and raises the existing gate finding (threshold lowered from 3 for this cause only). A human comment, decision answer or weaver steering wake clears the count.

## Risks

- A worker that legitimately does nothing (waiting in `in_review`) must not be failed: the rule applies only in statuses where the worker is expected to act, reusing `TICKET_STATUSES_NOT_EXPECTING_ACTION`.
- The end-to-end acceptance on the real codeify provider may not be runnable from a ticket (credentials rule); it is reported as unverified if so.
