## 1. Codex permission mapping

- [x] 1.1 Emit `mcp_servers.<name>.default_tools_approval_mode="never"` for daemon-provisioned MCP servers in both inline overrides and scratch config-file setup, while preserving `workspace-write`, `read-only`, and bypass mappings; verify with `packages/runtimes/codex/test/args.test.ts` for new, resumed, and forked invocations.

## 2. End-to-end runtime regression coverage

- [x] 2.1 Parameterize the isolated fake Codex turn harness across `auto`, `restricted`, and `bypass`, make a configured Weave AI MCP call succeed only when the per-server approval mode is `never`, and verify `packages/runtimes/codex/test/turn.test.ts` observes successful MCP tool-call events, mode-specific sandbox arguments, and no bypass flag for sandboxed modes.

## 3. Verification

- [x] 3.1 Run the Codex runtime test suite and strict OpenSpec validation for `vs-508-a-codex-worker-on-a-non-bypass-role-cann`; record that installed Codex binary inspection supports per-server MCP approval configuration while live MCP acceptance remains an owner-run verification; verify the worktree is clean apart from committed implementation and planning artifacts before delivery.
