## 1. Read a role's session before opening it

- [x] 1.1 Give `WorkersService.list` an optional kind filter defaulting to `['worker']` (`packages/core/src/workers/index.ts`); verify with a core test that `list()` still excludes `session`-kind agents and `list({ kinds: ['session'] })` returns only them
- [x] 1.2 Accept a `kind` csv parameter on `GET /workers` and pass it through as the list's kinds (`packages/server/src/routes/workers.ts`); verify with a server test that `?kind=session` returns sessions while the unparameterised call returns none
- [x] 1.3 Document the `kind` parameter on `GET /workers` in `docs/API.md`; verify the line is present and matches the parsed shape

## 2. One shared role-chat control

- [x] 2.1 Add `kind` to the `useWorkers` params and a `useSessions(projectId?, wsOverride?)` convenience in `packages/ui/src/api/hooks.ts`; verify by typecheck and by the section/roles tests exercising it
- [x] 2.2 Add a shared role-chat module exporting the pure helpers (`roleChatActionLabel`, `roleChatStateLabel`, `roleChatBlockedReason`) and the control component that calls `usePersistentSession` and navigates to the worker page; verify with vitest unit tests for start/open/blocked states and a render test that clicking calls the persistent-session mutation and navigates

## 3. The project overview's Roles section

- [x] 3.1 Add `packages/ui/src/v2/project/RoleChatsSection.tsx` reading `useRoles(project.id)` and `useSessions(project.id)`, listing each role's name, state and session existence with the shared control, an explicit reason for a non-active role, and an empty state when the project has none; verify it renders under the Roadmap section in `packages/ui/src/test/v2project.test.tsx`
- [x] 3.2 Register the section as key `roles`, label `Roles`, immediately after `roadmap` in `V2_PROJECT_SECTIONS` and the `V2ProjectSectionKey` union (`packages/ui/src/v2/project/sections.tsx`); verify the kept-sections test asserts it renders after Roadmap

## 4. The Roles screen keeps its door, with the same wording

- [x] 4.1 Replace the `Chat` button in `RoleCard` with the shared control and give the screen the session read (`packages/ui/src/v2/RolesPage.tsx`); verify `packages/ui/src/test/v2roles.test.tsx` asserts start-vs-open wording, that opening calls `usePersistentSession` and navigates, and that a paused or retired role shows the reason with no control

## 5. Evidence and gates

- [x] 5.1 Capture the overview (and the Roles control) at desktop and phone width in light and dark through the `ui-screenshot-harness` route, writing the files outside the worktree, and report their absolute paths on the ticket; verify each capture shows the Roles section below Roadmap with start/open distinguished
- [x] 5.2 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim on the ticket; verify `git status --porcelain` in the worktree is empty
