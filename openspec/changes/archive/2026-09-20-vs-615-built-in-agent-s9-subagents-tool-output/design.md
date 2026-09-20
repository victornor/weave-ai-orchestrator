## Context

S1–S8 are merged. `loop.ts` is one closure (`runAgentTurn`); tools run in the step loop at "for (const { c, args } of parsed)", with `ToolCtx.emit` for tool events. Partials already flow child → adapter (`ChildPartial`) → `TurnSink.onPartial` → engine `PartialBuffer` (50 ms coalescing, secret hold-back, `complete(partId)` on completed events carrying `payload.partId`). Codex already uses `tool_input` partials for command output (VS-601); the UI shows any `tool_input` partial as a running tool's output.

## Decisions

1. **Subagent = nested loop in the same child, sharing the request path.** `runExplore` is a closure function beside `runCompaction` in `runAgentTurn`: it keeps its own in-memory history and calls the same `streamStep` (retry ladder, timeouts, abort) quietly, so no loop code was extracted or duplicated. The history is not written to the session file: only the final text is a tool result in the parent session. Explore gets `read`, `grep`, `glob` regardless of mode (never more confinement lift than `auto`) and its own short system prompt; cap 20 steps, then it returns its last text with a note. Its tokens are added to the turn total. Alternative rejected: a second child process (needs a new protocol and pid/containment story) — the per-run-child decision is unchanged.
2. **Nesting by `parentId`, not a new event type.** Subagent events reuse existing types with `parentId` and ids `<taskId>/<n>`; the render transcript attaches them as children of the matching tool block. The `weave` adapter's `EVENT_TYPES` needs no change. Old runs have no `parentId` and render as before.
3. **`tool_output` is a new kind, not reuse of `tool_input`.** Codex's `tool_input` use stays as is (existing runtimes unchanged). The UI treats both as "tool output so far". `bash` gets an optional `ctx.onOutput(chunk)`; the loop turns it into a partial with `partId = <call id>:out` and coalesces at `partialFlushMs`. `tool.result` sets `partId` to that id, which the engine and `livePartials` already use to supersede. The 30 000-char tail result rule is untouched; the partial is cut by the engine's 64 KiB cap.
4. **Capability instead of table.** `core` reads the adapter registry; the UI reads `useRuntimes()` (`GET /api/runtimes` already returns capabilities) and passes `partialOutput` down, keeping the `runtimeId` prop only for lookup; TUI and CLI go through the same daemon route. Existing adapter tests that assert `RUNTIME_PARTIAL_OUTPUT[id]` become a golden test over the five runtimes plus weave against the declared capability. `RUNTIME_PARTIAL_OUTPUT` is deleted (an export removal inside the monorepo only).
5. **Hardening items** are small and independent: `confine.ts` protects the `.git` entry and the parsed `gitdir:` target; `RuntimeHost` gains an optional `configDir` read by the adapter and sent in `init.run` for confinement; `compactSession`/`forkSession` gain an optional `workspaceId` like `listModels`.

## Risks

- Extracting the step loop touches the most-edited file; mitigated by S5–S7 having landed and by keeping the existing loop tests unchanged as the guard.
- A subagent adds provider calls that count toward `maxConcurrentRuns`' rate pressure; accepted, capped by the step limit.
- Streaming output of a command that prints a secret: covered by the engine's redaction and a test.
