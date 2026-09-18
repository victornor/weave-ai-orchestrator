## Context

VS-508 (`a1bd7f99`, merged 2026-09-17) set
`mcp_servers.<name>.default_tools_approval_mode` on the daemon-provisioned
Weave MCP server for every non-`bypass` Codex turn. Its design conflated two
distinct Codex approval settings:

- `approval_policy` — when the *agent* asks a human to approve a shell/exec
  action. Its variants are `untrusted`, `on-request`, `on-failure`, `never`.
- `mcp_servers.<name>.default_tools_approval_mode` (Rust type `AppToolApproval`)
  — when an MCP *server's* tool calls prompt. Its variants are `auto`,
  `prompt`, `writes`, `approve`.

`never` is valid only for the first key. Written to the second it makes the CLI
refuse to load its configuration and exit before the turn exists. See
`proposal.md` — Why.

The installed runtime is Codex 0.154.0
(`~/.local/share/mise/installs/codex/0.154.0/bin/codex`). Read-only inspection
of the openai/codex source (`codex-rs/config/src/mcp_types.rs`) and of the
installed 0.150.1, 0.153.4 and 0.154.0 binaries establishes the semantics
below without executing the CLI.

`AppToolApproval` decides, per mode, whether a tool call still needs approval
(`codex-rs/core/src/mcp_tool_call.rs`):

| Value | Requires approval |
|---|---|
| `auto` | yes, for any tool not annotated read-only (weave tools declare no annotations) |
| `prompt` | always |
| `writes` | yes, unless the tool is annotated read-only |
| `approve` | never |

## Goals / Non-Goals

**Goals:**

- Make a Codex worker on an `auto` or `restricted` role start and call its
  ticket-scoped MCP tools by writing a value the installed CLI accepts.
- Keep VS-508's security shape: same per-server scope, same sandbox per mode,
  `bypass` untouched.
- Make an invalid value fail visibly, never silently.
- Record which roles and workspaces carried the broken value while it was live.

**Non-Goals:**

- Changing permission resolution, the permission-mode vocabulary, or the
  `auto`/`restricted`/`bypass` sandbox mapping.
- Adding MCP tool annotations (`readOnlyHint` etc.) to the daemon's tools; that
  is a separate design that `approve` makes unnecessary.
- Running the real coding CLI from this ticket (see R “Live verification”).

## Decisions

### Use `approve`, not `never`, and not `auto`

`approve` is the auto-approval variant: `requires_mcp_tool_approval_for_mode`
returns `false` for it, which is exactly the behaviour VS-508 reached for with
the wrong word. `auto` was the ticket's obvious candidate but does **not**
solve the original fault: it still asks for approval unless the tool declares
`read_only_hint`, and the daemon's MCP tools declare no annotations, so every
`weave_*` call would again wait on an approver a headless worker does not have.
`prompt` and `writes` are stricter than VS-508 intended. `approve` is
therefore the only value that preserves VS-508's fix and is accepted by the
CLI.

Because the key is set per MCP server, the change stays scoped to the
daemon-provisioned Weave server. It removes a tool-approval prompt, not the
filesystem sandbox.

### Keep the fix in the shared command/config path

`buildArgs` computes one `mcpApprovalMode` and passes it to both `mcpOverrides`
(inline `-c`) and `mcpConfigToml` (scratch `CODEX_HOME/config.toml`). Changing
the single constant and its declared type covers new, resumed and forked turns
on both paths. The type becomes `'approve'`, so an out-of-vocabulary value
cannot compile.

### Model the real CLI in the fake, from real bytes

The fake Codex process is extended to behave like 0.154.0 in two ways that the
previous fake did not: it rejects a `default_tools_approval_mode` outside
`auto|prompt|writes|approve` with the CLI's real error line, and it refuses an
MCP call while the effective mode still requires approval. Both are taken from
the actual bytes: the rejection line is the one observed in the incident
(`Error loading config.toml: unknown variant \`never\`, expected one of
\`auto\`, \`prompt\`, \`writes\`, \`approve\``), not a hand-written
paraphrase. This makes a regression to `never`, or to `auto`, fail the turn
tests instead of passing them.

### Reuse VS-526's failure-reporting contract; do not add a parallel requirement

VS-526 already specifies that a turn whose runtime exits before producing turn
output records the runtime's own error-stream message as the failure reason
(`persistent-sessions`, “A failed runtime start states why”), and the Codex
adapter already carries the first real stderr line out
(`firstStderrReason`, `packages/runtimes/codex/src/adapter.ts`). A rejected
configuration value is an instance of that, not a new failure class, so this
change adds no second requirement: it adds a regression test with a
`config_rejected` scenario that asserts the CLI's own message reaches the
run's error, and cites VS-526 as the governing contract.

### Do not try to discover the valid set at startup

The variant set is version-dependent by construction. Codex exposes no
non-interactive way to ask which variants a build accepts, and the daemon
cannot run the CLI to find out (see R “Live verification”). Reading the enum
out of the ELF is brittle and platform-specific. Instead:

- the value is one named constant of a narrow literal type, so our own mistake
  is a compile error;
- a unit test pins the constant to the accepted set;
- if a future Codex renames the variant, the CLI's own "unknown variant …
  expected one of …" message is carried to the run by VS-526's path, so the
  rename names itself in the run's failure reason rather than presenting as a
  bare exit.

That is “fails loudly, with the cause” rather than “fails at deploy”, and it is
the strongest guard available without executing the CLI.

## Risks / Trade-offs

- [Risk] A restricted worker's MCP tools run without approval even though its
  filesystem sandbox is read-only. → The setting only removes the tool-approval
  prompt; the sandbox, the daemon's tool entitlement filtering and the
  run-scoped token are unchanged. This is the same trade-off VS-508 accepted.
- [Risk] A future Codex version renames `approve` or the key. → The CLI's own
  rejection message is surfaced as the run failure reason; the constant and its
  test are the one place to update. See the decision above.
- [Risk] A value that only worked on an older CLI is written for a newer one,
  or vice versa. → `approve` is present in every installed build (0.150.1,
  0.153.4, 0.154.0) as read from their binaries; the adapter writes one value
  for all of them.
- [Risk] **Live verification.** The ticket's acceptance asks for a real Codex
  worker to be run. Repo rules forbid launching a coding CLI from a ticket
  against live credentials, and the automated proof therefore uses the fake
  CLI plus the captured real rejection bytes. The live check is an owner-run
  step against the deployed daemon; it is reported as unverified by this
  change. This mirrors VS-508's own handling.

## Migration Plan

No data migration. The change is to the value a turn writes at spawn time;
existing workers pick it up on their next turn. Once the release containing
this change is deployed, a Codex worker on a non-`bypass` role starts normally.
Rollback is a code revert, which restores the `never` value that breaks those
workers, so revert only if the replacement value is itself wrong.

## Affected roles and workspaces

The broken value applied to every role whose permission mode is not `bypass`
and whose agent runs on the Codex runtime, across every workspace using the
released daemon. The ticket names the Fernwood roles (`auto`). The window is
from the release of `a1bd7f99` until this fix ships. The concrete role and
workspace list is recorded on the ticket from the daemon's role records rather
than inferred from this repository, which holds no workspace role data.
