## Why

Slice 9 of the built-in `weave` agent. Three gaps remain after S1–S8: the model cannot delegate a bounded read-only investigation without spending its own context on it; a long `bash` command shows nothing until it finishes, although the live-progress machinery (VS-595–VS-602) can already stream partials; and the live UI decides whether a run can stream from a hard-coded per-runtime id table (`RUNTIME_PARTIAL_OUTPUT`), so every new runtime needs a shared-package edit. The review of VS-608 and VS-612 also left three hardening items on this ticket.

## What Changes

- A `task` tool that runs an **explore** subagent: read-only (`read`, `grep`, `glob`), depth 1, cancelled with its parent, with its own fresh history; only its final text returns to the parent as the tool result. Its events carry `parentId` (the `task` call id) and the transcript nests them under that call.
- `RuntimePartial.kind: 'tool_output'` (additive) and the same kind on `run.delta` parts: `bash` streams its merged output as partials while it runs; the completed `tool.result` supersedes them. The engine's `PartialBuffer` already redacts every part with the secret-split hold-back, so this covers `tool_output`; a test pins a secret split across two chunks.
- `RUNTIME_PARTIAL_OUTPUT` stops being the source of truth: `core`, the web UI, the TUI and the CLI read `capabilities.partialOutput` from the registered adapter (`GET /api/runtimes` for the UI). The table is removed; a golden test pins opencode, claude, codex, cursor and gemini to what they declare today.
- Hardening carried from review comments: protect the `.git` entry itself and the resolved gitdir of a linked worktree in `confine.ts`; protect the daemon config directory once `RuntimeHost` exposes it; scope `compactSession` and `forkSession` provider-key resolution to the session's workspace.
- Update `builtin-agent-design`, `builtin-agent-runtime-details` and `builtin-agent-slices` where this changes them.

No behaviour change for the five existing runtimes. No new config keys. No live provider or credential is used.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `builtin-agent`: the `task` explore subagent, `bash` output streaming, linked-worktree `.git` and daemon-config protection, workspace-scoped compaction and fork key resolution.
- `live-run-progress`: `tool_output` partials, and partial-output capability read from the runtime rather than a per-runtime table.

## Impact

`packages/agent` (`tools/task.ts`, `tools/bash.ts`, `tools/confine.ts`, `loop.ts`, `protocol.ts`, `permission.ts`), `packages/runtimes/weave`, `packages/runtime-sdk` (`RuntimePartial`, `compactSession`/`forkSession` signature, `RuntimeHost`), `packages/core` (`runs/partials.ts`, `activity`, engine), `packages/shared` (`events.ts`), `packages/render` (`livePartials`, `liveTurn`, transcript nesting), `packages/ui` (`LiveActivity`, `LivePartials`), `packages/tui`, `packages/cli`.
