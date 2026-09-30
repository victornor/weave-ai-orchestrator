## Why
Codex `auto` workers run under `--sandbox workspace-write`, which has no network: DNS fails, so API tests, `curl` and package fetches break (VS-709, 2026-09-27), and weavers across workspaces report codex agents as heavily limited. VS-685 and VS-704 were per-symptom workarounds for the same sandbox. Captain's instruction (2026-09-30): pass `--sandbox danger-full-access` to every codex instance.

## What Changes
- Every Codex invocation (`exec` new/resume/fork and the app-server thread) runs with sandbox `danger-full-access`, in every permission mode, for every agent kind.
- Approval handling is unchanged per mode: `auto` keeps `approval_policy=on-request` and MCP `default_tools_approval_mode="approve"`; `bypass` keeps `--dangerously-bypass-approvals-and-sandbox` (already full access, so no second sandbox flag); `restricted` keeps approval `never`-style declines but is no longer OS-sandboxed.
- Remove the now-dead VS-685 writable-roots override (`sandboxWritableRoots`, `gitdir.ts`, `sandbox_workspace_write.writable_roots`).
- **BREAKING (intended):** `restricted` on Codex is no longer read-only at the OS level.

## Impact
`packages/runtimes/codex/src/{args,app-server,adapter,gitdir}.ts` and tests; specs `codex-runtime`, `run-permissions/conductor-bypass`.
