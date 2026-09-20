## 1. Streaming tool output

- [x] 1.1 Add `tool_output` to `RuntimePartial.kind`, `ChildPartial.kind`, `RunDeltaPart.kind` and the render partial types; keep every existing consumer compiling
- [x] 1.2 `bash` reports output through `ctx.onOutput`; the loop emits `tool_output` partials with `partId` `<id>:out` and sets `partId` on `tool.result`
- [x] 1.3 Engine partial tests: `tool_output` coalescing, secret split across two chunks, supersession by `tool.result`
- [x] 1.4 `LivePartials` and `liveTurn` show `tool_output` like tool input; UI test

## 2. Capability-driven live UI

- [x] 2.1 Core activity, UI, TUI and CLI read `capabilities.partialOutput`; remove `RUNTIME_PARTIAL_OUTPUT`
- [x] 2.2 Golden test over opencode, claude, codex, cursor, gemini and weave; UI test that a new runtime declaring `full` streams

## 3. Subagents

- [x] 3.1 A nested run reuses the loop's provider request path (`streamStep`, retry ladder, abort); the existing loop tests pass unchanged
- [x] 3.2 `tools/task.ts`: explore subagent (read, grep, glob only, depth 1, step cap, shared abort, usage added, only final text returned)
- [x] 3.3 `parentId` on subagent events; transcript nests them under the `task` block; render golden test
- [x] 3.4 Mock-provider tests: read-only enforcement, no nesting, cancel with parent, `restricted`, `deniedTools`

## 4. Hardening carried from review

- [x] 4.1 `confine.ts` protects the `.git` pointer and the resolved gitdir; temp-dir test
- [x] 4.2 `RuntimeHost` exposes the daemon config dir; confinement protects it; test
- [x] 4.3 `compactSession`/`forkSession` take an optional workspace id; the engine passes it; two-workspace test

## 5. Docs and delivery

- [x] 5.1 Update `builtin-agent-design`, `builtin-agent-runtime-details`, `builtin-agent-slices` and `docs/` where this changes them
- [x] 5.2 Lint, typecheck, one full `pnpm test` at the end (`--maxWorkers=4`), both suite blocks pasted
