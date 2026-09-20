## 1. Move role-chat navigation into the mutation's own success

- [x] 1.1 In `packages/ui/src/api/hooks.ts`, add an optional `onOpened?: (agent: Agent) => void` to `usePersistentSession` and invoke it from the `useMutation` `onSuccess` (after the existing `workers` invalidation); verify `pnpm --filter @weave-ai/ui typecheck` passes.
- [x] 1.2 In `packages/ui/src/v2/roleChat.tsx`, change `useRoleChatOpen(ws, onOpened?)` to pass the navigation (`go('/w/$ws/workers/$workerId', { params: { ws, workerId: agent.id } })`) and `onOpened?.()` into `usePersistentSession`'s `onOpened`, and stop passing a per-call `onSuccess` to `mutate`; verify `v2rolechat.test.tsx` passes after its mock is updated in 3.
- [x] 1.3 In `RoleChatRow`, call `useRoleChatOpen(ws, onNavigate)` and drop the `onNavigate?.()` from the click handler so the More sheet closes only when the open succeeds; verify the new regression test in 2.1 passes and the row's `not opened` state still renders on failure.

## 2. Regression tests for the unmount hazard

- [x] 2.1 Add a component test where `RoleChatRow`'s `onNavigate` unmounts the row before a deferred `persistent-session` response resolves, asserting navigation to the session's worker page still happens (fails today); verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/v2rolechat.test.tsx`.
- [x] 2.2 Add a test that activating a role under a workspace the app is not showing navigates with that workspace's id; verify it fails against the old click-before-open ordering and passes after.
- [x] 2.3 Add a test that a failed open leaves the row mounted showing `not opened` and the phone More sheet open; verify it passes.

## 3. Update the existing role-chat tests and mocks

- [x] 3.1 Update the `usePersistentSession` mocks in `v2shell.test.tsx`, `v2roles.test.tsx` and `v2project.test.tsx` to accept the options argument and invoke `onOpened` on success, preserving their open assertions; verify those files pass.
- [x] 3.2 Update `v2rolechat.test.tsx` for the new `useRoleChatOpen` contract; verify the whole file passes.

## 4. Evidence, audit and gates

- [x] 4.1 Audit `RoleChatControl`'s callers (`RoleChatsSection.tsx`, `RolesPage.tsx`) for the unmount hazard and record the finding in the ticket report; verify no caller closes a surface on click.
- [x] 4.2 Record a navigation trace from the test harness (desktop rail and phone More) showing the tap reaching the persistent chat page, and attach it to the ticket; verify the artifact renders.
- [x] 4.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (one suite at a time, `--maxWorkers=4`) and record both suite blocks verbatim in the report.
