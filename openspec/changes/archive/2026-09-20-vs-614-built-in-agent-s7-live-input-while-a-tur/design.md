## Context

See `proposal.md` — Why. The code this change has to fit:

- `bin.ts` reads stdin only until `init`; `parseParentLine` already parses `send` (`protocol.ts`), but the child drops it with the comment "live input arrives with S7".
- `spawnLines` (runtime-sdk) returns a handle with `write(line): boolean`, and `TurnHandle.send?(text): Promise<InputDelivery>` with `InputDelivery = 'delivered' | 'closed' | 'unsupported'` already exists. The adapter currently hands the engine a handle with only `pid` and `cancel`.
- The engine always sets `TurnInput.outputSchema = RUN_REPORT_JSON_SCHEMA` (`packages/core/src/runs/engine.ts:569`) and prefers `result.structured` over `extractReport(result.finalText)`; `TurnResult.structured?: unknown` exists in the SDK and the adapter's `finish()` spreads the child result, so only the protocol and the loop need the field.
- `packages/core/src/workers/index.ts` already delivers a live human message through `active.send` when the runtime declares `streamingInput`, and `runs/active.ts` gates `midTurn` on that capability plus a running turn with an open handle. Enabling the capability is what makes weaver live input work; there is no core change.
- Codex emits `plan.proposed` with `{ id, items }` from its todo list; `plan.proposed` is a `RunEventType` and counts as progress for the silence window. `packages/render` and `packages/ui` reduce that event to one status line and never read `items`.
- The loop's step body is one `for (;;)` iteration: compaction check, one retried request, append assistant content, then run the parsed tool calls and append their results. A `parsed.length === 0` step returns `finish()`.

## Goals / Non-Goals

**Goals**

- A `send` that reaches a running turn is delivered at the next request boundary, in a valid history, and the adapter can say `delivered` or `closed` without guessing.
- With `outputSchema` set, the turn's report arrives as `TurnResult.structured`, and a model that cannot fill the schema is corrected rather than silently producing an unparsed text report.
- The model can maintain a todo list through a tool, with the same run event the other runtime's todo list produces.
- Capabilities, adapter surface and tests reflect all of it.

**Non-Goals**

- Any UI change for the todo list; item rendering is not built. The child's `send` is a queue, not a priority/injection channel. `submit_result` is not validated again by the engine; the child validates against the run's schema and the engine keeps its existing `RunReportSchema` check and text fallback. No second wire format and no new protocol version.

## Decisions

**1. The steering queue lives in the child, not the adapter.** The adapter only writes a line; it never buffers text, so text accepted while the child is between steps is still delivered by the child's own loop, and there is one place where ordering against tool results is decided. A new `SteeringQueue` (`packages/agent/src/steering.ts`) holds `push(text)` and `drain(): string[]`; `bin.ts` pushes every `send` line it reads after `init`. Alternative rejected: the adapter collecting text and writing it at its own guessed boundary — it cannot see the child's step boundaries.

**2. Drain at the top of the step loop, before the next request.** Each loop iteration starts by draining the queue into the session as `user` messages; because the previous iteration appended the assistant message and its tool results before reaching the top again, the text lands after the tool results and the next request carries it. Draining mid-stream was rejected: the assistant message being assembled is not yet committed, and a message injected into the middle of a request cannot be sent.

**3. A step with no tool calls continues while the queue is non-empty.** `parsed.length === 0` now checks the queue first: if it has text, append the messages and `continue`; otherwise return as today. That is the pi "steering" semantic the design specifies and what makes a mid-turn human message answered in the same turn.

**4. `send` resolves `closed`, never throws, once the result exists.** The adapter's handle is closed over a flag set when the child's `result` line is parsed (or the spawn ends); `send` then returns `closed` without writing. A write that fails (stdin closed) also returns `closed`. `unsupported` is no longer returned by this adapter, and `capabilities.streamingInput` becomes `true`.

**5. Structured output is a tool, not a wire mode.** When `outputSchema` is present the child adds a `submit_result` tool whose `parameters` are that schema, and appends a pinned instruction to call it last. A valid call sets `structured`, appends the tool result (so the persisted history keeps the call paired), and ends the turn. `response_format: json_schema` is not used: every profile this runtime accepts has tools, and the tool path also lets a schema error be corrected in conversation. The synthetic tool is added to the map after the mode and allow/deny filters, so it is offered in every mode including `restricted`, and an exhaustive `allowedTools` on a first interactive turn cannot remove it. The nudge path (the model stops with text and no call) is bounded at two, matching the design's loop sketch.

**6. Validation is a small dependency-free JSON-Schema subset.** `validate.ts` checks `type` (string or array of strings, including `null`), `enum`, `required`, `properties`, `additionalProperties: false` and `items`. That is exactly what `RUN_REPORT_JSON_SCHEMA` uses, and the repo has no JSON-Schema library today; pulling in `ajv` for six keywords was rejected. Unknown keywords are ignored rather than failed, and the engine's own `RunReportSchema.safeParse` plus `extractReport` fallback remain the last word, so a validator gap cannot lose a report.

**7. Invalid `submit_result` arguments are corrected twice, then fail the turn.** The first two invalid calls return an ordinary tool result listing the violations (a correction the model can act on) and do not count as a generic invalid tool call; the third ends the turn with `tool_call_invalid` in `tooling`, the family the design's error table already assigns to repeated invalid calls. `finalText` keeps the natural-language text seen so far, so a session answer is still non-empty when the model spoke around the call.

**8. `todo_write` state is loop-scoped and the event matches codex.** The tool replaces a module-scoped-per-turn list held by the loop; the model always supplies the whole list, and the session history already contains every prior call. It emits `plan.proposed` with `{ id: <callId>, items: [{ content, status }] }` — codex's event shape for its todo list — so a surface that renders plans for codex renders one for weave. The existing renderer shows a single plan status line for that event and never reads `items`; per-item rendering is deliberately out of scope. `todo_write` joins `ALL_CORE_TOOLS` and `RESTRICTED_CORE_TOOLS`, because a planning or restricted turn still needs to state a plan.

**9. Protocol v1 is unchanged in shape.** `init.outputSchema` and `result.structured` are optional additions; `parseParentLine` already returns `send`, so no version bump is needed, and an older adapter speaking to a newer child simply never sets the schema.

**10. Only a turn that owes a report carries the schema, and the engine decides.** `runs/engine.ts` sets `outputSchema` only when `ticket !== null || agent.kind !== 'session'` — a worker, the weaver, a planner, or a session that took a ticket. A ticketless persistent session is a raw session (VS-618, VS-620): no report rules and no shaping of its replies, so it must not be handed a `submit_result` or nudged. The gate is in the engine because that is where "what this turn owes" is known; gating in the weave adapter would need the same fact plumbed to the runtime, and gating on the runtime id in the engine is exactly the literal-branching the repo forbids. Every runtime therefore sees the rule apply uniformly: a turn that owes a report still gets the schema (so claude/codex/planner behaviour is unchanged), and the only turns that stop getting it are ticketless sessions — which is the ruling. If a future slice wants the schema suppressed on some other turn, it adds one condition here.

## Risks / Trade-offs

- **A plan status line that reads "waiting for approval"** appears for every `todo_write` call, exactly as it already does for codex's todo list. Accepted: matching the other runtime is the requirement; a dedicated todo rendering is a UI change nobody asked for.
- **The validator subset can accept something the real schema would reject**, or reject something valid. → Unknown keywords are ignored, and the engine re-parses `structured` with `RunReportSchema` and falls back to `extractReport(finalText)`, so the worst case is the old behavior.
- **`submit_result` is always in the tool list** for every weave turn, which costs schema tokens on every request and adds a way for the model to stall. → The nudge is bounded at two; the schema is the run's own and is already counted in the window estimate.
- **A `send` during the final streaming request of a turn with no tool calls** arrives after the loop has already started the last request; it is drained when that request's step ends, so it is answered in the same turn only if the step ended with tool calls or the queue was non-empty at the top of the iteration. This is the design's request-boundary semantic, not a lost message: the engine's next turn picks it up.
- **`finalText` for a turn that only calls `submit_result`** may be the model's brief text or empty. Accepted: `finalText` is not part of this slice's contract and the engine reads `structured` first.
- **The gate is engine-wide, not runtime-specific.** A ticketless session on claude or codex also stops receiving the schema; that is the same raw-session ruling and arguably already overdue, but it is a visible behaviour change for those runtimes on exactly one kind of turn. Treated as intended rather than hidden.
- **A planner turn is treated as owing a report** (it is a non-session agent), which keeps other runtimes' planner behaviour identical; the conductor's list named worker, weaver and ticketed session, and this is the reading that changes the least.

## Migration Plan

None. The protocol change is additive and both ends ship in the same release directory; no session file format changes, so existing sessions load unchanged.

## Open Questions

None that change the specs, the approach, or the task breakdown.
