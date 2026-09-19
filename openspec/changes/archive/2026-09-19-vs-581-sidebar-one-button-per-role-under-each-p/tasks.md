## 1. Open a role's session in the right workspace

- [x] 1.1 Let `usePersistentSession` take an optional workspace override (`packages/ui/src/api/hooks.ts`), resolving it with `useHookWs` and invalidating that workspace's worker cache; verify by typecheck and by the existing role-chat tests still passing unchanged.
- [x] 1.2 Extract the open-or-resume call into `useRoleChatOpen(ws?)` in `packages/ui/src/v2/roleChat.tsx` and make `RoleChatControl` use it, so the control and the new sidebar row share one implementation; verify the existing `v2rolechat.test.tsx` start/open/blocked/navigation assertions pass unchanged.

## 2. The role row control and its pure row list

- [x] 2.1 Add `roleNavRows(roles, { cap, activeRoleId })` to `packages/ui/src/v2/roleChat.tsx`, returning the shown roles (cap applied, the active role always included) and how many are hidden; verify with unit tests for cap, empty project and active-role pinning.
- [x] 2.2 Add a `RoleChatRow` component to `roleChat.tsx`: an active role renders a keyboard-reachable child row that calls `useRoleChatOpen`; a blocked role renders a non-actionable row named with `roleChatBlockedReason`; the current session's role carries `data-role-chat-current`; verify with render tests for each state.
- [x] 2.3 Add the `.v2-row-child-current` style for the marked row (`packages/ui/src/index.css`); verify the marked row's class is applied and the style resolves in the render test.

## 3. Put the rows in the rail and the phone More list

- [x] 3.1 Fetch each listed workspace's roles and session agents in `V2Shell` and pass them down; verify by typecheck and the shell tests rendering.
- [x] 3.2 Render the role rows under Roadmap in `ProjectRow`, including the `+N more roles` row opening the project overview, and pass the data from `WorkspaceGroups` and `MoreList`; verify with a shell test that the rail and the phone More list both list the roles under Roadmap, cap the list, and add nothing for a project with no roles.
- [x] 3.3 Verify a project with no roles adds no row and that the active conversation's role row is marked when its session page is shown.

## 4. Tests pin the acceptance criteria

- [x] 4.1 UI test: clicking an active role row calls the persistent-session open with that role's project and role, against that project's own workspace, and navigates to `/w/$ws/workers/$workerId`; verify it fails before the row exists.
- [x] 4.2 UI test: the phone More list carries the same role rows and opening one navigates the same way.
- [x] 4.3 UI test: a paused, retired and awaiting-hire-approval role each render a non-actionable row carrying its reason, and no open call is made.

## 5. Evidence and gates

- [x] 5.1 Capture the sidebar at desktop and phone width, in light and dark, for a project with several roles (including the cap), a project with none, and a paused role, following `docs/ui-screenshot-harness.md`; keep the files outside the worktree, attach them to the ticket, and compare each against the Roadmap row's look.
- [x] 5.2 Run `pnpm lint && pnpm typecheck && pnpm test`, paste both suite blocks verbatim on the ticket, and confirm `git status --porcelain` in the worktree is empty.
