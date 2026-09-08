## Why

The usage page's credential row shows `expires in 7h` for a healthy Claude credential. That number is
`claudeAiOauth.expiresAt` — the OAuth **access token's** expiry, which refreshes itself every few
hours by design. Styled as a countdown, it reads as "the login dies in 7h", which is false: captain
read it exactly that way. But the login genuinely can go bad (it did, 2026-09-08 14:09, forcing a
re-login) — the fix must say the credential is healthy without claiming it can never expire.

## What Changes

- The healthy-credential row on the usage page stops rendering a countdown to the access token's
  expiry. It shows the credential as healthy, with the last-verified moment as evidence when known.
- Investigated whether Claude's credential file carries a longer-lived, genuinely actionable expiry
  (a refresh-token or session deadline) worth showing instead of the countdown: it does not.
  `claudeAiOauth` (`packages/runtimes/claude/src/credential.ts`) holds only the access token, the
  refresh token, scopes and subscription type — no separate expiry for the refresh token. The one
  `expiresAt` the runtime reports is the self-refreshing access token's, for every credential state
  the row can be in.
- Checked Gemini and OpenCode: neither implements the optional `readCredential` on `RuntimeAdapter`,
  so their `expiresAt` is always `null` already — they never showed a countdown and need no change.
  The fix generalises across runtimes for free: no runtime's `expiresAt` is a deadline a human could
  act on, so none is shown as one.
- The expired-login row (`needsLogin`) is untouched: it already shows when the refresh failed and
  what to run, and stays exactly as it is.

## Capabilities

### Modified Capabilities

- `runtime-credentials/credential-visibility`: the usage view's requirement for what it shows about a
  healthy credential changes from "shows when it expires" to "shows it is healthy, with last-verified
  evidence, never a countdown to a self-refreshing access token's expiry". The expired-login behavior,
  the diagnostic command's behavior, and the underlying credential-state-recording requirement are
  unchanged.

## Impact

- `packages/ui/src/components/RuntimeCredentials.tsx`: drop the countdown (`until()`) for the healthy
  row; keep the absolute-time `at()` helper for `lastVerifiedAt` and the unchanged expired-login text.
- `packages/ui/src/test/usage.test.tsx`: update the credential-panel tests for the new healthy-row
  text; the expired-login test is unchanged.
- No server, database or type change: `expiresAt` keeps being read and stored exactly as before
  (`packages/runtimes/claude/src/credential.ts`, `packages/core/src/usage/accounts.ts`) — this is a
  display-only change. `RuntimeCredential`/`UsageCredential` keep the `expiresAt` field.
- Out of scope, per the ticket: credential refresh behaviour itself (VS-105), and the plan-limit reset
  countdowns elsewhere on the usage page (those are genuine deadlines). The `doctor` CLI command's
  absolute-timestamp expiry line (`packages/cli/src/commands/doctor.ts`) is also left as is: it is not
  styled as a countdown and the ticket's acceptance criteria are scoped to the usage page.
