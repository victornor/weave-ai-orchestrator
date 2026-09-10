## Why

After daemon `4e2a2900c7`, every global page (`/needs`, `/live`, `/chats`, `/incidents`, `/map`) dies on the error page with `useWorkspace outside WorkspaceProvider`. VS-168 put those routes outside `/w/$ws` with chrome that has no `WorkspaceProvider`; one leftover hook in that chrome still calls `useWs()`. Captain cannot use Needs you / Live / Chats / Incidents / Map until this renders.

## What Changes

- Global pages render without throwing. Shared chrome that mounts on those routes MUST NOT call `useWorkspace()` / `useWs()`.
- Visiting a global page still MUST NOT call `setWorkspaceId` or clobber `conductor.ws`.
- Per-workspace routes under `/w/$ws` still wrap `WorkspaceProvider` and still work.
- A route test mounts a global page (with the same chrome the router uses) without a workspace in the URL and asserts it does not throw.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: global Needs you / Live / Chats / Incidents / Map SHALL render without a `WorkspaceProvider` and without rewriting the remembered workspace. Today they throw before that contract can hold.

## Impact

- `packages/ui/src/app/AppShell.tsx` — currently calls `useTransitionTicket()` on every page, including global ones.
- `packages/ui/src/api/hooks.ts` — `useTransitionTicket` is the observed `useWs()` caller; any other hook AppShell (or global-route chrome) still binds through `useWs()` gets the same treatment (`useHookWs`).
- `packages/ui/src/router.tsx` — global routes stay siblings of `/w/$ws`; no new provider around AppShell.
- Tests: a chrome/route test that mounts a global page without `WorkspaceProvider` and without `$ws` in the URL. Existing global-page tests mock `../api/hooks` and never mount AppShell, which is why they stayed green.
- No daemon, API, CLI, TUI, Telegram, or schema change.
