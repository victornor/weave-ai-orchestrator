## 1. Codex permission translation

- [x] 1.1 Translate Codex `auto` into its sandboxed automatic-approval invocation for new, resumed, and forked turns while retaining separate restricted and bypass mappings; verify focused Codex argument tests cover each invocation mode and assert auto never emits the bypass flag.
- [x] 1.2 Preserve the complete daemon-provisioned MCP server configuration (including bearer-token environment handling) through each Codex invocation mode; verify focused Codex argument tests assert the server endpoint and no token in argv.

## 2. MCP stream evidence

- [x] 2.1 Extend the fake-Codex turn fixture to reproduce the historical `requires approval` failure before the automatic approval mapping and to complete read/write MCP calls after it; verify new, resumed, and forked adapter tests receive structured tool success and error results without ending a successful turn.
- [x] 2.2 Make malformed or unsupported Codex MCP events produce bounded explicit runtime evidence; verify parser tests assert an actionable error/raw event rather than silent omission.

## 3. Verification and handoff

- [x] 3.1 Run Codex adapter tests and the runtime SDK test suite using only fake executables and scratch config directories; verify every selected suite passes.
- [x] 3.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; verify and record each test-suite block verbatim in the delivery report.
- [x] 3.3 Document the confirmed adapter root cause and the blocked worker incident-reporting gap in the ticket report; verify the report names the filed incident and states that no live Codex CLI was invoked.
