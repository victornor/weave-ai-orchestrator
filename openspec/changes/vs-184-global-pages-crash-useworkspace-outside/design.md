## Context

See `proposal.md`. Constraints that shape the approach:

- Global routes (`/needs`, `/live`, `/chats`, `/incidents`, `/map`) are siblings of `/w/$ws` in
  `packages/ui/src/router.tsx`. Each mounts `<AppShell>` with no `WorkspaceProvider`. Workspace
  routes wrap `<WorkspaceProvider ws={ws}>` then `<AppShell />`.
- VS-168 already chose this: `AppShell.onGlobalPage` skips marking an active workspace, skips
  `setWorkspaceId`, and fans in `FanInStreams`. Chat panes wrap a local
  `<WorkspaceProvider remember={false}>`. Data hooks on global pages use `useHookWs(override)` or
  `*Many` fan-out, not `useWs()`.
- `useWs()` throws `useWorkspace outside WorkspaceProvider` (`packages/ui/src/api/context.tsx:45`).
  Observed caller on every global page: `AppShell` always calls `useTransitionTicket()`
  (`AppShell.tsx:49`), which calls `useWs()` (`hooks.ts:725`). Hooks cannot be skipped by
  `onGlobalPage`.
- Existing global-page tests mock `../api/hooks` and never mount AppShell. `appshell.test.tsx` mocks
  context to always return `ws1`. That is why the suite stayed green.

## Goals / Non-Goals

**Goals:**

- Global chrome runs without a provider and without rewriting `conductor.ws`.
- The throw is gone for all five global paths, including after a later hook is added to AppShell
  that would otherwise call `useWs()`.
- A test that would have caught this: mount the same chrome the router uses, at a global path, with
  no `$ws` and no `WorkspaceProvider`.

**Non-Goals:**

- Wrapping global AppShell in a dummy `WorkspaceProvider`.
- Changing FanInStreams, GLOBAL_NAV, or per-workspace layout.
- Telegram / TUI / daemon.

## Decisions

### D1. Stop calling `useWs()` from global chrome; do not wrap AppShell

Convert every hook AppShell (and any other chrome that mounts on a global route) still binds
through `useWs()` to `useHookWs()`, so an absent provider yields `''` and the query/mutation is
disabled. `useTransitionTicket` is the known one; sweep AppShell's hook list so a second leftover
cannot survive.

Command-palette "set status" already no-ops on a global page: `useTickets` is `useHookWs` and
disabled without a workspace, so there is no `tickets.data[0]` to mutate. Passing an explicit `ws`
into that mutation is out of scope.

**Rejected:** wrapping global AppShell in `<WorkspaceProvider ws={getWorkspaceId()} remember={false}>`.
There is no `$ws` on these URLs. A remembered id would make `useOptionalWorkspace()` truthy, start
fetching that workspace's summary/decisions/tickets from AppShell, and fight VS-168's "no provider
on global chrome" rule. `remember={false}` is for a pane that *has* a workspace (Global Chats), not
for the shell.

**Rejected:** making `useWs()` itself non-throwing. Per-workspace routes should still fail loudly if
a provider is missing.

### D2. One chrome test, not five mocked page tests

Add a test that renders `AppShell` (real `../api/context`, no `WorkspaceProvider`) with the router
pathname a global path (`/needs` is enough if chrome is shared) and asserts it does not throw and
does not write `conductor.ws`. Keep existing per-page tests; they do not catch this.

Parametrize or add a thin assertion that `/live`, `/chats`, `/incidents` and `/map` share that
chrome in `router.tsx` (already true in `router.test.tsx`) so a later route that forgets AppShell is
a different bug.

Per-workspace board (or chat) still renders inside `WorkspaceProvider` — existing tests cover that;
do not weaken them.

## Risks / Trade-offs

- [A later AppShell hook reintroduces `useWs()`] → The chrome test mounts real context without a
  provider; it fails if any hook AppShell calls throws. Do not mock `useTransitionTicket` (or
  context) away in that test.
- [useTransitionTicket with empty `ws` POSTs to `/api/w//…`] → Disable the mutation when `ws` is
  empty, same `Boolean(ws)` pattern as `useTickets` / `useDecisions`.
- [Global Chats still uses `useWs()` inside each pane] → Those panes stay wrapped in
  `WorkspaceProvider remember={false}`. Out of scope to change ChatPage.

## Migration Plan

Ship in the web UI. No data migration. Rollback is revert. Captain must run `conductor daemon
upgrade` after merge for the running daemon to serve the new UI.
