## Context

The run engine deliberately resolves a worker's permission from its role or
workspace default and reserves `bypass` for the weaver. The Codex adapter
currently translates the normal `auto` result only into a workspace-write
sandbox. Captured failure text from the affected worker is `MCP tool call
requires approval, but approval policy is never`; the weaver succeeds because
its separate `bypass` path avoids that policy. The server already creates the
same ticket-scoped HTTP MCP server, bearer token, and tool scope for both
agent kinds.

## Goals / Non-Goals

**Goals:**

- Make Codex's `auto` posture capable of using the already-scoped Weave MCP
  server while keeping it sandboxed.
- Preserve the three engine-level permission meanings and every non-Codex
  runtime's arguments.
- Make MCP success, failure, and malformed event evidence observable in the
  Codex run stream.

**Non-Goals:**

- Altering the MCP endpoint, run-token tool scope, role configuration, or the
  worker model tier.
- Giving all workers Codex bypass permissions.
- Launching a real Codex CLI against live credentials for verification.

## Decisions

### Treat Codex auto as a complete Codex permission posture

For a new headless turn, the adapter will select Codex's sandboxed automatic
approval invocation rather than only selecting its filesystem sandbox. For
`exec resume` and `exec fork`, where the sandbox flag is not accepted, it will
carry the equivalent approval and sandbox settings through supported config
overrides. `restricted` remains read-only and `bypass` remains the explicit
dangerous bypass flag.

This keeps the engine's existing worker `auto` decision intact and repairs the
adapter's incomplete translation. Making the worker engine path use `bypass`
was rejected because it would expand worker authority rather than fix Codex's
auto-mode argument mapping.

### Exercise the boundary with a fake Codex executable

Tests will use the existing absolute-interpreter fake CLI and scratch config
directory. The fake will reject an MCP invocation unless the recorded
automatic approval posture is present, then emit both successful and failed
MCP calls. Tests will cover a new turn and resumed/forked turns, asserting the
full per-run server wiring, structured result/error events, and a continued
turn after the tool result. A malformed MCP event will produce an explicit
runtime error/raw evidence event rather than being silently omitted.

This is deterministic and avoids executing the real CLI or reading runtime
credentials. A hard-coded list of Weave tool names was rejected: the server
name and tool set must remain run-token scoped.

## Risks / Trade-offs

- [Codex changes its argument semantics] → Pin the behavior in pure argument
  tests and the fake-CLI end-to-end fixture; use the config override form on
  resumed commands where the CLI does not accept the new-turn sandbox flag.
- [Automatic approval is mistaken for bypass] → Assert the auto mapping keeps
  workspace-write sandboxing and never emits the bypass flag.
- [A malformed stream is obscured] → Preserve a bounded raw/error event with
  the event kind and validation reason.

## Migration Plan

1. Land the adapter and regression tests.
2. New Codex worker invocations use the corrected auto posture immediately;
   resumed turns receive the equivalent overrides on their next process start.
3. Roll back by reverting the adapter commit; no persisted config or schema
   migration is involved.
