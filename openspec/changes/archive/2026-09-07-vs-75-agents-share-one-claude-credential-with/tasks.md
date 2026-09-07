## 1. The shared credential

- [x] 1.1 Add `readCredential?(input: { configHome: string }): { present: boolean; expiresAt: string | null }` to `RuntimeAdapter` in `packages/runtime-sdk/src/index.ts`, documented as a file read that never returns the token; verify `pnpm typecheck` is clean with no adapter implementing it yet.
- [x] 1.2 Implement `readCredential` in `packages/runtimes/claude/src/` against `claudeAiOauth.expiresAt`, returning `{present:false}` for a missing file and `{present:true, expiresAt:null}` for one it cannot parse; verify with a unit test over a fixture credential file containing a dummy token, asserting the returned object has no token-bearing field.
- [x] 1.3 Replace the copy in `seedRuntimeCredentials` (`packages/core/src/workspace/loader.ts:270`) with `linkRuntimeCredentials`: symlink each workspace credential path to its host path, for all four runtimes; verify with a test using a scratch `HOME` that the workspace path is a symlink resolving to the host file and that no second regular file exists.
- [x] 1.4 Add `reconcileRuntimeCredential(runtimeId, home)` implementing Decision 2 (later expiry wins, only-one-parses wins, neither-parses keeps the host's, then re-link, mode 0600); verify with unit tests for each of the four branches plus an idempotence test that a second run changes nothing.
- [x] 1.5 Add a reconcile test that pins both CLI write styles with a fake CLI — one writing through the symlink, one renaming a temp file over it — asserting that after reconciliation there is one credential, it is the newer one, and the workspace path is a link again.
- [x] 1.6 Add a test that an older credential at the workspace path never overwrites a newer host credential even when the older file's mtime is later, pinning that mtime is not the criterion.
- [x] 1.7 Call reconcile before each turn and after each turn in `packages/core/src/runs/engine.ts` (replacing the seed at line 236) and after each probe in `packages/core/src/usage/accounts.ts:71`; verify the existing engine and accounts suites pass.
- [x] 1.8 Confirm the portable/archive workspace path does not dereference the credential symlink; verify `packages/core/src/workspace/portable.test.ts` passes and add a case asserting a copied workspace carries no credential file contents.

## 2. Credential state and the gate

- [x] 2.1 Add migration `packages/db/src/migrations/0012_runtime_credentials.sql` creating `runtime_credentials` keyed by `(workspace_id, runtime_id)` with `present`, `expires_at`, `last_verified_at`, `refresh_failed_at`, `needs_login`, `detail`, `updated_at`; verify the migration test suite applies it on a fresh and on an existing database.
- [x] 2.2 Add `RuntimeCredential` to `packages/shared/src/types.ts` with no token-bearing field, and `credentials()`, `credential(id)`, `noteAuthFailure(id, detail)`, `noteVerified(id)` to `AccountsService` in `packages/core/src/api.ts` and `packages/core/src/usage/accounts.ts`; verify with unit tests that a failure then a verification round-trips the state and that `expiresAt` comes from `readCredential`, not from a CLI launch.
- [x] 2.3 Gate the dispatcher: exclude agents whose runtime has `needs_login = 1` from the candidate query in `packages/core/src/runs/dispatcher.ts`; verify with a test that a gated agent's queued wakeup is still `queued` (not claimed) after several ticks, and that an agent on another runtime still runs.
- [x] 2.4 Add `gateRuntimeForLogin` per Decision 4 — per-step guards, pause the runtime's agents with a login reason, one `gate_finding` decision correlated on `runtime-login:<runtimeId>`, and `threads.notifyHuman`; verify with a test that three failing agents on one runtime produce exactly one open decision and one channel message.
- [x] 2.5 Remove the auth force re-seed at `engine.ts:377`, the `auth` rung of the retry ladder, and `auth` from the `agentStatus` retry expression at `engine.ts:339`; route an `auth` failure to `gateRuntimeForLogin` instead of `parkForHuman`; verify with tests that an auth failure schedules no retry wake, raises no `retry_approval`, does not block the ticket, and does not write the credential file.
- [x] 2.6 Add `ungateRuntime`: clear `needs_login`, set `last_verified_at`, un-pause every agent paused with the login reason, withdraw the decision by correlation key; verify with a test that the previously gated agents' queued wakeups are dispatched on the next tick without any re-enqueue.
- [x] 2.7 In `packages/core/src/supervisor/index.ts`, probe gated runtimes every 60 s, skipping the probe when the credential's expiry is unchanged since `refresh_failed_at`, and call `ungateRuntime` only when `describeAccount` returns a `billingType` other than `unknown`; verify with tests that a failing probe leaves the gate up, that a probe reporting `unknown` for a missing binary does not un-gate, and that a successful probe un-gates.
- [x] 2.8 Suppress the resume affordance for a worker paused with the login reason while its runtime is gated, in the workers service and every surface that offers resume; verify with a test that resume is not offered for such a worker and is offered again once the runtime is un-gated.

## 3. Surfaces

- [x] 3.1 Expose the credential state on the accounts route in `packages/server/src/routes/` (registering any literal path above an existing `/:id` route); verify with a server test that the response carries `present`, `expiresAt`, `lastVerifiedAt`, `refreshFailedAt`, `needsLogin` and asserts no token-shaped field is present.
- [x] 3.2 Show the credential state in `packages/ui/src/routes/Usage.tsx` — valid with its expiry, or the expired-login state with when the refresh failed and what to run; verify with a UI test covering both states, and update every `../api/hooks` mock that a new hook breaks.
- [x] 3.3 Add a per-runtime credential check to `packages/cli/src/commands/doctor.ts` that fails and names the login command when a login is needed; verify with a CLI test over a stubbed daemon response for both the valid and the needs-login case.
- [x] 3.4 Add a redaction test asserting that no credential-related log line, decision, channel message or API response contains a token from a fixture credential.

## 4. Documentation

- [x] 4.1 Document the credential model in `docs/OPERATIONS.md` — one file per runtime per host, the symlink, the expiry-wins reconcile, the gate, and how to recover from an expired login; verify the section names the file paths and the recovery command.
- [x] 4.2 Add the "never launch the real CLI against live credentials from inside a ticket" rule to `.claude/skills/agent-conductor-worker/`; verify the rule states the reason (the refresh token rotates on use, invalidating every agent's login) and what to do instead.

## 5. Verification

- [x] 5.1 Run `pnpm typecheck` (which chains `tsc -b` before the ui filter) and `pnpm lint`; verify both are clean.
- [x] 5.2 Run `pnpm vitest run` and `pnpm --filter @agent-conductor/ui exec vitest run` separately; verify both suites pass, including the harnesses in `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` that a changed `AccountsService` touches.
- [x] 5.3 State in the PR description that the real Claude CLI's credential-write style is unverified by design, that the tests pin both possibilities with a fake CLI, and what the owner would run to confirm it outside a ticket.
