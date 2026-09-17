## Why

Codex headless turns default to `approval_policy="never"`, so a worker on a non-bypass role can start normally but cannot call its daemon-provisioned Weave AI MCP server. The existing auto-mode override is covered mainly by argv assertions and the restricted posture is not verified end-to-end, leaving this critical failure able to recur without a worker-visible control-plane error.

## What Changes

- Configure each daemon-provisioned Weave MCP server for headless tool calls while preserving each mode's sandbox boundary; MCP approval is a separate decision path from shell-command approval.
- Preserve `workspace-write` for `auto`, `read-only` for `restricted`, and the existing dangerous bypass posture for `bypass`.
- Emit `mcp_servers.<name>.default_tools_approval_mode="never"` for the run-scoped Weave server through both inline overrides and scratch config-file setup, so new, resumed, and forked turns can call entitled MCP tools without a human approver.
- Extend the fake-CLI integration coverage so each permission mode launches an isolated Codex command with a configured Weave AI MCP server and receives successful MCP tool-call events; assert that bypass is not used for non-bypass modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-permissions/conductor-bypass`: Codex worker turns in both sandboxed non-bypass modes can call their entitled ticket-scoped MCP tools without being promoted to bypass, including resumed and forked turns.

## Impact

- `packages/runtimes/codex/src/args.ts` and its adapter tests, plus the fake Codex turn harness under `packages/runtimes/codex/test/`.
- The existing run-permissions contract; no public API or permission-mode names change.
- Read-only inspection of the installed Codex 0.154.0 binary establishes that MCP approval is distinct (`mcp_tool_call_approval`), exposes `mcp_servers.<name>.default_tools_approval_mode`, and supports `--approve-for-me` only with the `workspace-write` sandbox. The per-server setting is therefore the candidate that covers both sandboxed modes without promoting `restricted`; the real coding CLI/MCP call is not launched from the ticket because doing so can consume live credentials and rotate the owner's login. Live acceptance remains an owner-run check.
