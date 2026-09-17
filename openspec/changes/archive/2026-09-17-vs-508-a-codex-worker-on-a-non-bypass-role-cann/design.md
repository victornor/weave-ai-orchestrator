## Context

`buildArgs` already maps Codex permission modes to sandbox settings and adds
`approval_policy="on-request"` for `auto`. That setting alone is the manual
approval path, so it does not fix the incident: the failing auto workers were
already launched with it and still reported an effective `never` policy when
the MCP call needed approval. Read-only inspection of the installed Codex
0.154.0 binary confirms a separate `mcp_tool_call_approval` path and exposes
`mcp_servers.<name>.default_tools_approval_mode`; it also exposes
`--approve-for-me`, but documents that route as using the `workspace-write`
sandbox. The per-server setting is the candidate that can cover both
`workspace-write` and `read-only` workers. New turns use `--sandbox`, while
resumed and forked turns use `-c sandbox_mode=...`, so the MCP setting must be
written by the shared server configuration path for all three modes.

The existing fake-CLI turn harness captures the exact command and emits
structured MCP events, but its default input covers only `auto` and `bypass`.
The real coding CLI must not be launched from a ticket: it can consume live
credentials and rotate the owner's login. Verification therefore uses an
isolated fake executable and scratch config directory, with captured argv and
MCP events as adapter regression evidence. It cannot prove live Codex
acceptance; that final check remains explicitly unverified until the owner runs
it safely.

## Goals / Non-Goals

**Goals:**

- Make Codex `auto` and `restricted` turns MCP-callable by disabling approval
  prompts for the daemon-provisioned Weave MCP server while retaining their
  distinct filesystem sandbox boundaries.
- Apply the same behavior to new, resumed, and forked headless turns.
- Exercise command construction and actual adapter spawning through the fake
  CLI, including successful MCP call events and the absence of bypass flags.

**Non-Goals:**

- Changing permission resolution in the run engine or the meaning of role
  permission modes.
- Making `bypass` safer or changing Codex's dangerous bypass flag.
- Running a live coding CLI or changing credentials, runtime configuration
  ownership, or MCP server authorization.

## Decisions

### Set the run-scoped Weave MCP server's default approval mode to `never`

The Codex headless default blocks MCP calls at `never`, and plain
`on-request` still routes an MCP approval request to a human reviewer that a
headless worker does not have. The installed CLI exposes a per-server
`default_tools_approval_mode` setting alongside its MCP approval path. Set it
to `"never"` on the daemon-provisioned Weave server: this removes the
server-tool approval prompt, not the shell sandbox, so `auto` remains
`workspace-write` and `restricted` remains `read-only`.

The alternative `--approve-for-me` explicitly routes approval through the
automatic reviewer using `workspace-write`, so it cannot be the shared fix for
restricted workers. Leaving the per-server setting unset reproduces the
incident; promoting either mode to `--dangerously-bypass-approvals-and-sandbox`
would violate the role's security contract. Both are rejected.

### Emit the override in `mcpOverrides` and `mcpConfigToml` for every turn mode

The existing server configuration helpers are used by both the inline `-c`
path and the scratch `CODEX_HOME/config.toml` path. Add the per-server setting
there for the daemon-provisioned server; the existing `--sandbox` versus
`sandbox_mode` branching remains unchanged. Bypass will continue to emit only
Codex's explicit dangerous bypass flag and will not receive this override.

### Test through the adapter with an isolated fake CLI

Extend the fake Codex process used by `turn.test.ts` to parameterize the
permission mode and to reject a configured Weave AI MCP server unless its
`default_tools_approval_mode="never"` setting is present. Run the
new/resume/fork matrix for both sandboxed modes, assert the mode-specific
sandbox argument, assert successful parsed MCP tool-call events, and assert no
bypass flag. Keep a separate bypass case asserting the existing dangerous flag
and no per-server override. This verifies the produced command reaches an
actual spawned process without invoking a live credential-bearing CLI, but the
owner must still run one safe live MCP check because the fake cannot prove
Codex's internal approval decision.

## Risks / Trade-offs

- [Risk] The per-server MCP approval setting could be renamed or restricted by
  a future Codex CLI release. → Keep the fake CLI contract focused on the exact
  emitted config and MCP success path; the owner must perform the live check
  against the deployed CLI, and any changed output should update the adapter
  from captured real bytes under the credential-safety rule.
- [Risk] A restricted worker could use MCP writes despite its read-only
  filesystem sandbox. → Preserve daemon-side tool entitlement filtering and
  Codex's `read-only` sandbox; this change only removes the headless MCP
  approval default that prevented all calls.
- [Risk] Resume/fork behavior can regress independently from new turns. → Keep
  explicit assertions for all three command modes rather than testing only the
  first-turn argv.

## Migration Plan

No data migration is required. Ship the adapter and regression tests together;
existing workers pick up the new command on their next turn. Rollback is a
code revert, which restores the prior per-mode argv behavior.
