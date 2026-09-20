## Why

Codex is the "quick" worker tier and the one runtime that cannot stream with a flag: `codex exec --json` emits only `item.started`/`item.completed`, so a Codex worker page shows whole steps only. VS-595 built the partial-output model (`onPartial`, `run.delta`, live activity row) and delivered it for opencode; the deltas Codex would supply exist only in the `codex app-server` protocol.

## What Changes

- The Codex adapter drives each turn through `codex app-server` (JSON-RPC over stdio: `thread/start`/`resume`/`fork`, `turn/start`, notifications, server requests) and translates it into the existing normalized events plus `onPartial` frames (agent text, reasoning, command output, tool progress).
- `tool.call` is emitted at item start (command executions, file changes and MCP calls), not at completion; the persisted completed events are unchanged.
- Approvals are answered by the adapter according to the run's permission mode, reproducing today's `exec` postures.
- `codex exec --json` stays, unchanged, as the automatic per-turn fallback when the app-server cannot be started or initialised, or when `options.appServer === false`.
- `capabilities.partialOutput` becomes `'full'`; the whole-steps-only statement no longer applies to Codex.
- Partial frames go through the same secret redaction as persisted events.
- Fixtures recorded from a real `codex app-server` (against a local mock model provider and a scratch `CODEX_HOME`, no credentials), and a fake server for the driver's tests.

## Capabilities

### New Capabilities
- `codex-runtime`: how a Codex turn is driven, translated, approved, cancelled and resumed, and when it falls back to `exec`.

### Modified Capabilities
- `live-run-progress`: runtime coverage now includes Codex with `partialOutput: 'full'`.

## Impact

- `packages/runtimes/codex` (new app-server driver and translator, adapter wiring, tests, fixtures); `packages/core` (a test only: the engine already redacts partial frames, VS-595); `packages/ui` and `packages/render` only for tests/evidence, since the page already renders `partialOutput: 'full'` runtimes.
- No schema migration, no new dependency, no change to how the daemon stores events.
