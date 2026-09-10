# Switching workspaces must not 404 the conductor chat

Tracker change for [VS-166](conductor://tickets/VS-166).

## Why

Switching from one workspace's conductor chat to another's often shows an error
and a 404 on `GET /threads/:id/messages`, because the client keeps the previous
workspace's thread id and asks the newly active workspace for it. A full page
reload is the only recovery today. Thread ids are workspace-scoped; the web app
must not cross them.

## What Changes

- The conductor chat binds its selected thread to the active workspace. Switching
  workspace selects that workspace's web thread (or creates one) and never keeps
  the previous workspace's thread id.
- `GET /threads/:id/messages` is not issued with a thread id that belongs to a
  different workspace.
- A `not_found` on messages for a thread that is not this workspace's is recovered
  in-app: drop that id, select or create this workspace's thread. A genuinely
  deleted thread of the current workspace may still 404.
- A chat/route test covers switching workspace without the error page.

## Capabilities

### New Capabilities

- `conductor-chat/workspace-thread`: the web conductor chat's selected thread is
  scoped to the active workspace; messages are fetched only for that workspace's
  thread; a cross-workspace 404 recovers without a document reload.

### Modified Capabilities

- (none — `workspace-navigation/sidebar-workspaces` already requires switching
  context without a reload and reading subsequent data from the new workspace;
  this change specifies the chat thread that requirement currently misses.)

## Impact

- `packages/ui/src/routes/Chat.tsx` — `threadId` state is not keyed by workspace;
  the selection effect bails once any id is set. `live` / `sending` / attachments
  also leak across a chat-to-chat switch of the same `/chat` route.
- `packages/ui/src/api/hooks.ts` — `useThreadMessages` enables as soon as `id` is
  truthy, against `useWs()`, which is how the 404 is produced.
- `packages/ui/src/test/chat.test.tsx` — route tests mock hooks wholesale; the
  workspace-switch case must drive `useWs` + `useThreads` + the id passed to
  `useThreadMessages`.
- No daemon, API, CLI, TUI, or Telegram change.
