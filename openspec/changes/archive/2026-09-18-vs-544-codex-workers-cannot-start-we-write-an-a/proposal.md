## Why

VS-508 made Codex workers on non-bypass roles able to call their control-plane MCP server by writing `mcp_servers.<name>.default_tools_approval_mode="never"`. But `never` is a variant of the separate `approval_policy` key, not of `default_tools_approval_mode`, whose accepted variants are `auto`, `prompt`, `writes`, `approve`. Codex 0.154.0 therefore refuses to load the configuration and exits before its first turn, so every Codex worker on an `auto` or `restricted` role dies at startup (observed 2026-09-18 on VS-505).

## What Changes

- Write the CLI's auto-approve variant `approve` instead of `never` for the daemon-provisioned Weave MCP server, on `auto` and `restricted` Codex turns, for new, resumed and forked sessions, through both the `-c` override path and the scratch `config.toml` path.
- Preserve VS-508's intent: the server's tools are callable without a human approver, while the `auto`/`restricted`/`bypass` filesystem sandbox mapping and the `bypass` posture are unchanged.
- Make the fake Codex CLI model the real 0.154.0 `AppToolApproval` enum: it rejects any other value with the CLI's real rejection bytes, and refuses an MCP call when the configured mode still requires approval. This turns "an invalid value" from a green test into a red one.
- Prove that a rejected runtime configuration is reported with the runtime's own message rather than a bare exit, using the real captured stderr bytes. This reuses VS-526's failed-start contract instead of adding a parallel one.
- State the version-dependence finding: the valid variant set cannot be discovered without executing the CLI, so the value comes from one named constant and the CLI's own rejection is the loud failure path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-permissions/conductor-bypass`: the Codex daemon-provisioned MCP server's `default_tools_approval_mode` value changes from `never` to `approve`, and the requirement now names the value the installed CLI actually accepts.

## Impact

- `packages/runtimes/codex/src/args.ts` — the one value, its type, and the comments explaining the two approval keys.
- `packages/runtimes/codex/test/args.test.ts`, `test/turn.test.ts` and the in-file fake Codex CLI — expected value, enum modelling and the config-rejection regression.
- `openspec/specs/run-permissions/conductor-bypass/spec.md` via the change delta.
- No public API, permission-mode name, sandbox mapping or MCP authorization change. No credential, launcher or daemon behavior change.
