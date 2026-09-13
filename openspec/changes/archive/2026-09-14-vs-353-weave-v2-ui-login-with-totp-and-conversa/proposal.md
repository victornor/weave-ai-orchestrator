## Why

V2 already has its shell, Mono theme and navigation at `/v2` (VS-343), but not its two entry screens.
Today an unauthenticated visitor to any `/v2` address is sent to V1's `/login`, and `/v2` with no
remembered workspace redirects to V1's `/onboarding` — so V2 cannot be entered or first-run on its own.
The redesign's `17-login` and `16-onboarding` are the last pair of mocked screens that no V2 ticket
covers. Without them `/v2` is a shell that always hands the human back to V1.

## What Changes

- **A chromeless V2 sign-in page at `/v2/login`.** It reuses V1's existing authentication — password,
  the TOTP second step, `remember this device`, first-run set-password, and the same error and lockout
  states — restyled to Mono in both themes and at phone width. No chrome: no rail or header.
- **An unauthenticated `/v2` visit resolves to V2 login and returns to where it came from.** Every
  `/v2` address, opened without a session, shows `/v2/login` carrying the original address; after
  sign-in the app returns there. Only `/v2` paths are honoured as the return target. V1's `/login`,
  `?next=` handling and 401 redirect are unchanged.
- **A conversational V2 onboarding at `/v2/onboarding`.** A chat-like, five-step flow (`step N of 5`)
  driving V1's existing workspace creation (`weave init`), model selection and project add, restyled
  to Mono in both themes and at phone width. Completing it creates the workspace, adds the projects and
  lands in V2.
- **The five steps** are: 1 business / workspace name · 2 id, prefix and path · 3 projects and then the
  "How much should I check with you before acting?" autonomy question · 4 default CLI and model ·
  5 review and create. The autonomy question draws the mockup's three answer chips and persists the
  choice, on success, to the existing `defaults.proposalApproval` / `defaults.yolo` settings through
  the same config write Settings uses. No chip is pre-selected, and a line under them says what each
  choice does and that action approvals always stay with the human.
- **`/v2` with no remembered workspace lands on the V2 onboarding route** rather than V1's `/onboarding`.
- **V1 at `/` is unchanged.** The V2 login and onboarding addresses are additive.

## Capabilities

### New Capabilities

- `web-v2/login`: the chromeless V2 sign-in screen (password and TOTP) that reuses V1's auth, and the
  rule that any unauthenticated `/v2` address resolves to it and returns to the original address.
- `web-v2/onboarding`: the conversational five-step V2 first-run flow that drives V1's workspace setup
  and project add, including the autonomy question mapped to existing workspace settings, and the rule
  that `/v2` with no remembered workspace resolves to it.

### Modified Capabilities

- `web-v2/shell`: the requirement "The V2 root resolves a workspace the way V1 does" is updated so
  `/v2` resolves to V2's own sign-in and onboarding addresses — not V1's `/login` and `/onboarding` —
  while the underlying onboarding-or-sign-in decision is unchanged.

## Impact

- **New:** `packages/ui/src/v2/` — a V2 login page and a V2 onboarding page (plus their chat, chip and
  TOTP presentation), reusing `v2.css`, `V2Page`, `WeaveMark` and the V2 theme hook.
- **Modified:** `packages/ui/src/router.tsx` (register the two V2 routes; change the `/v2` index
  redirect target); `packages/ui/src/api/client.ts` (make the 401 redirect V2-aware so a `/v2` address
  is remembered and returned to, without touching V1's behaviour).
- **Reused, not forked:** `packages/ui/src/routes/Login.tsx`'s auth logic and `TOTPInput`;
  `packages/ui/src/routes/Onboarding.tsx`'s `useInitWorkspace`, `PUT /models`, `POST /projects`,
  job progress and resume handling; `packages/ui/src/components/{Button,JobProgress,WeaveMark}`.
- **New UI tests** under `packages/ui/src/test/` for the unauthenticated redirect, the TOTP step, the
  post-login return, and the onboarding redirect.
- No HTTP route, MCP tool, CLI command, database migration or daemon change. V1's screens and tests are
  untouched.
