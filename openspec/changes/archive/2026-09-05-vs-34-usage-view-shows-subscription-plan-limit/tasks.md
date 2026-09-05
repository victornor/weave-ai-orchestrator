## 1. Shared types and the adapter contract

- [x] 1.1 Add `ACCOUNT_LIMIT_KINDS` (`session`, `weekly_all`, `weekly_scoped`) with its `AccountLimitKind` type to `packages/shared/src/enums.ts`, and `AccountLimitWindow` + `RuntimeAccount` to `packages/shared/src/types.ts`, reusing the existing `BILLING_TYPES`; verify `pnpm typecheck` is green and no new string literal is branched on.
- [x] 1.2 Add the optional `describeAccount(input: AccountProbeInput): Promise<AccountDescription>` method and its `AccountProbeInput` / `AccountDescription` types to `RuntimeAdapter` in `packages/runtime-sdk/src/index.ts`; verify every existing adapter still satisfies the interface under `pnpm typecheck`.

## 2. The Claude probe

- [x] 2.1 Add a pure `parseUsageControlResponse(line: string): AccountDescription` to the claude runtime that maps `subscription_type`, `rate_limits_available` and the normalised `rate_limits.limits[]` array onto the shared shape, ignoring every other key; verify with a unit test over a recorded fixture of the real response (subscription with session + weekly + model-scoped windows).
- [x] 2.2 Cover the degraded paths in the same parser test: no `subscription_type` → `metered_api` with a note; `rate_limits_available: false` → `limitsAvailable: false`, no windows; a window missing `percent` → omitted, never zero; unparseable line → `unknown` with the reason in `note`.
- [x] 2.3 Implement `describeAccount()` on the claude adapter: spawn `claude -p --output-format stream-json --input-format stream-json --verbose` with `CLAUDE_CONFIG_DIR` from `configHome`, write one `get_usage` control request to stdin, parse the first `control_response`, 20 s timeout; verify a non-zero exit, a timeout and a missing binary each resolve to an `unknown` description with a note instead of throwing (unit test against a stub command, no real CLI).

## 3. The other adapters

- [x] 3.1 Implement `describeAccount()` on the opencode adapter returning a static `metered_api`, `limitsAvailable: false` description with a note that OpenCode bills through provider keys; verify by unit test.
- [x] 3.2 Implement `describeAccount()` on the codex and gemini adapters, deciding the billing mode from `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY` in the probe env and otherwise from the presence of `auth.json` / `oauth_creds.json` in `configHome`, never reading a credential's contents; verify with unit tests over a temp directory for both branches, asserting `limitsAvailable: false` and a note naming what the CLI does not expose.

## 4. Storage and the accounts service

- [x] 4.1 Add migration `packages/db/src/migrations/0008_runtime_accounts.sql` creating `runtime_accounts` keyed on `(workspace_id, runtime_id)` as in design.md; verify `packages/db/src/migrations.test.ts` passes on a fresh database.
- [x] 4.2 Add an `accounts` service to `packages/core/src/usage/` with `list()` and `refresh(runtimeIds?)`, upserting one row per runtime and leaving the previous row in place when a probe throws or times out; verify with core tests using a fake adapter that a successful probe replaces the row, a failing probe leaves it unchanged, and `list()` returns the stored windows and capture time.
- [x] 4.3 Register the service on `CoreServices` / `packages/core/src/api.ts` and export it; verify `pnpm typecheck` and `pnpm lint` are green.

## 5. Refresh and attribution

- [x] 5.1 Add the 5-minute `due('supervisor:accounts_at', …)` refresh pass to the supervisor tick, resolving the distinct runtime ids used by the workspace's non-retired agents, projects and roles; verify with a supervisor test that a runtime in use is probed, a runtime nothing uses is not, and a failing probe does not fail the tick.
- [x] 5.2 Make `recordUsage` fall back to the current snapshot's billing type for `row.runtimeId` when the caller passes none; verify with a usage test that a run on a `subscription_included` runtime stores that billing type and that a run with no snapshot still stores `unknown` (the existing `recordUsage` tests stay green unchanged).
- [x] 5.3 Add `billingMix: { subscription, metered, unknown }` token totals to `usage.series()`, computed from the rows already scanned for the queried scope and window; verify with a usage test over mixed rows.

## 6. API surface

- [x] 6.1 Add `GET /api/w/<ws>/usage/accounts` to `packages/server/src/routes/usage.ts` and `routetable.ts`, returning each snapshot with its runtime display name from the registry; verify with a server route test.
- [x] 6.2 Document the route and the `billingMix` field in `docs/API.md`, and record the `runtime_accounts` table, the poll and the view behaviour in `docs/PLAN.md` §16.2/§16.3; verify the route appears in both the route table and API.md.

## 7. Views

- [x] 7.1 Add `accountLimits()` to `packages/render/src/usage.ts` returning the display rows (plan label, per-window label, percent, reset-in, scope, snapshot age) and a `showCost(billingMix)` predicate; verify with golden tests covering a subscription account with three windows, an account with `limitsAvailable: false`, and an empty account list.
- [x] 7.2 Render the plan panel in `packages/ui/src/routes/Usage.tsx` from a data-aware component fed by props, and hide the cost tile and the cost columns when `showCost` is false; verify with UI tests for the subscription mode, the API-key mode, and the no-snapshot mode.
- [x] 7.3 Print the same block from `conductor usage`, suppressing the cost line when `showCost` is false; verify with a CLI test asserting the subscription output has the windows and no cost line, and the metered output is unchanged.

## 8. Delivery

- [x] 8.1 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all three are green, then open the PR and record it on the ticket.
