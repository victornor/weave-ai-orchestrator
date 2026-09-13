## 1. Split the V2 root and mount the two entry routes

- [x] 1.1 Make `V2Root` own only the `.v2-root` token element, its `data-theme` and `<Outlet/>`, and
  move `V2Shell` into a pathless shell layout route under it that wraps the existing destinations.
  Every current V2 address stays the same because a pathless route adds no URL segment. Rebase on
  `origin/main` before pushing: VS-345, VS-346, VS-347 and VS-348 are adding children under
  `v2RootRoute` at the same time, so every `v2GlobalRoute`/`v2WsRoute` child that has landed by then
  must be moved under the shell layout, and `v2router.test.ts` re-run against the re-parented tree.
- [x] 1.2 Register `/v2/login` under the token root (no shell) and `/v2/onboarding` under the shell
  layout, both lazy-loaded from the V2 module.
- [x] 1.3 Change the `/v2` index resolution: remembered workspace → `/v2/w/<ws>/needs`; nothing
  remembered → `/v2/onboarding`; a remembered workspace the daemon no longer reports → forget it and
  resolve again. V1's `/` route and redirect are not touched.
- [x] 1.4 Verify with a test that `/v2/login` and `/v2/onboarding` exist, every previous V2
  destination keeps its address, and no merge-queue route appears.

## 2. The V2 login screen and the unauthenticated path

- [x] 2.1 Build `packages/ui/src/v2/V2Login.tsx`: a chromeless page on the token root showing the
  `WeaveMark`, username and password, then the TOTP step via `TOTPInput`, the remembered-device
  choice, the first-run set-password step, and the wrong-credentials, lockout-countdown and
  expired-session states — reusing `api.root('/auth/setup' | '/auth/login')`, `/health` and `/me`.
- [x] 2.2 Read the remembered `next` value and honour it only when it is a `/v2` path; with none,
  resolve `/v2` the way an opening of `/v2` resolves. On success set the token, invalidate `/me` and
  land.
- [x] 2.3 Make the API client's 401 handler V2-aware: a rejected request whose current path is under
  `/v2` sends the browser to `/v2/login?next=<path>` and treats `/v2/login` as terminal; every other
  path keeps V1's `/login` redirect.
- [x] 2.4 Add a `beforeLoad` guard on the V2 subtree that sends a visitor to
  `/v2/login?next=<current path>` before the page fetches, treating a visitor as anonymous only when
  the daemon refuses the request as unauthenticated (401 or `auth_session_expired`) — never because a
  200 `/me` body carries no session. This is what keeps a trusted loopback browser (`/me` 200,
  `session: null`, `operator.id: null`) from looping to the sign-in.
- [x] 2.5 Verify with tests: an unauthenticated `/v2/<anything>` resolves to `/v2/login` carrying
  `next`; the TOTP step appears when the daemon answers `totpRequired` and a valid code lands the
  session; sign-in returns to the remembered `/v2` address; a `next` that is not a `/v2` path is
  ignored; a `/me` 200 with a `null` session does not redirect; V1's `/login` redirect is unchanged.

## 3. The conversational V2 onboarding

- [x] 3.1 Build the conversation frame in `packages/ui/src/v2/V2Onboarding.tsx`: weaver and human
  messages, the `N / 5` progress, chips for a closed-set answer, and the action that submits the
  current step.
- [x] 3.2 Implement the five steps in order: 1 business / workspace name · 2 id, ticket prefix and
  directory (derived, editable) · 3 projects (git URL) followed by the autonomy question · 4 default
  runtime and model · 5 review and create.
- [x] 3.3 Wire create to V1's existing operations: `useInitWorkspace`, `PUT /models`,
  `POST /projects` with the job stream and `JobProgress`, failed-step retry, and the
  `ac.onboarding.resume` re-attach; on success remember the workspace and land in V2.
- [x] 3.4 Build the autonomy chips: three answers, none pre-selected, an explanatory line naming
  each answer's effect and that action approvals stay with the human; on create success persist
  `defaults.proposalApproval` (`human` / `weaver`) or `defaults.yolo: true` through `PATCH /config`;
  write nothing when create fails.
- [x] 3.5 Make first-run with zero workspaces render correctly: the shell shows the Everywhere group
  with no workspace group, and the phone tab bar does not link a workspace-scoped tab to an empty
  workspace.
- [x] 3.6 Verify with tests: `/v2` with no remembered workspace resolves to `/v2/onboarding`; each
  chip maps to the settings above and none is pre-selected; a failed create writes no approval
  setting; finishing the flow creates the workspace and lands in V2.

## 4. Theme, width and visual match

- [x] 4.1 Render both screens in dark and light from `useV2Theme`, using the Mono tokens, the one
  bordered tag recipe and 4–6px corners; never a pill, never an opacity dim.
- [ ] 4.2 Make both screens fluid at phone width and compare them against
  `docs/design/v2/shots/{desktop,phone}-{dark,light}/17-login.png` and `16-onboarding.png`, allowing
  for real data, and adjust spacing and type so each mode matches.

## 5. Verification

- [x] 5.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 5.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 5.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed: the
  work is frontend-only and both V2 addresses are served by the existing static fallback.
- [x] 5.4 Run `openspec validate vs-353-weave-v2-ui-login-with-totp-and-conversa --json --strict`
  and confirm it is clean.
- [ ] 5.5 Treat the acceptance list as the exit criteria: an unauthenticated `/v2` address shows V2
  login and password + TOTP return to the original address; `/v2` with no workspace reaches V2
  onboarding, which creates the workspace and lands in V2; both screens match their four-mode
  screenshots; the unauthenticated redirect, TOTP step, post-login return and onboarding redirect are
  covered by tests.
