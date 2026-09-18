## 1. Correct the approval value

- [x] 1.1 In `packages/runtimes/codex/src/args.ts`, change `McpApprovalMode` and the value selected for non-`bypass` turns to `'approve'`, and rewrite the comment so it distinguishes `approval_policy` (`never`/`on-request`) from `default_tools_approval_mode` (`auto`/`prompt`/`writes`/`approve`); verify `pnpm --filter @weave-ai/codex test` compiles the narrow type
- [x] 1.2 Update `packages/runtimes/codex/test/args.test.ts`: every inline and `config.toml` expectation becomes `default_tools_approval_mode="approve"` / `= "approve"`, add an assertion that `never` is absent for that key, and keep the bypass case asserting no override
- [x] 1.3 Verify `mcpOverrides` and `mcpConfigToml` are the only emitters and both cover new/resume/fork through the shared `mcpApprovalMode`; confirm a typo or an out-of-vocabulary literal fails `pnpm typecheck`

## 2. Make the fake CLI model the real 0.154.0 behaviour

- [x] 2.1 In `packages/runtimes/codex/test/turn.test.ts`, make the fake Codex reject a `default_tools_approval_mode` outside `auto|prompt|writes|approve` (inline and `config.toml`) with the captured real line ``Error loading config.toml: unknown variant `never`, expected one of `auto`, `prompt`, `writes`, `approve` `` and a non-zero exit
- [x] 2.2 Make the fake refuse an MCP call while the configured mode still requires approval (`auto`, `prompt`, `writes`), so the `auto`/`restricted` success matrix only passes with `approve`
- [x] 2.3 Update the turn matrix expectations from `"never"` to `"approve"` and assert `--dangerously-bypass-approvals-and-sandbox` is still absent for sandboxed modes
- [x] 2.4 Add a `config_rejected` scenario asserting the run's `error.message` is the CLI's own configuration error (not `exit_1`), reusing VS-526's failed-start contract; verify with `pnpm --filter @weave-ai/codex test`

## 3. Spec and observability alignment

- [x] 3.1 Confirm the `run-permissions/conductor-bypass` delta names `approve` and that no second requirement duplicates VS-526's failed-start contract; verify `openspec validate vs-544-codex-workers-cannot-start-we-write-an-a --json --strict` is clean

## 4. Verification and reporting

- [x] 4.1 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim on the PR
- [x] 4.2 Record on the ticket which roles and workspaces carried the broken value while it was live (every non-`bypass` role on the Codex runtime in each workspace; the ticket names the Fernwood roles as `auto`), and state that the live Codex worker check is owner-run because a ticket must not launch a coding CLI
