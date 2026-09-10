## 1. Chrome hooks

- [x] 1.1 Convert `useTransitionTicket` (and any other hook `AppShell` still calls through `useWs()`) to `useHookWs`, disabling the mutation when the workspace id is empty. Verify `AppShell` and global routes import no `useWs` / `useWorkspace`.
- [x] 1.2 Leave global routes as `/w/$ws` siblings with no `WorkspaceProvider` around `AppShell`. Verify `router.tsx` still mounts `/needs`, `/live`, `/chats`, `/incidents` and `/map` that way, and `/w/$ws` still wraps `WorkspaceProvider`.

## 2. Regression test

- [x] 2.1 Add a test that mounts `AppShell` with real `../api/context` (no `WorkspaceProvider`) at a global pathname and asserts it does not throw `useWorkspace outside WorkspaceProvider` and does not write `conductor.ws`. Verify the test fails if `useTransitionTicket` is reverted to `useWs()`.
- [x] 2.2 Confirm per-workspace chrome still works: existing AppShell / board (or chat) tests that wrap `WorkspaceProvider` stay green.

## 3. Cover it

- [x] 3.1 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
