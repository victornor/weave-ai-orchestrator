## Why

`/chats` never populates: the daemon answers in single-digit milliseconds, so the hang is
client-side connection-pool exhaustion, confirmed by reading the code (not just the ticket's
hypothesis):

- `AppShell` mounts `FanInStreams` for every global page including `/chats`
  (`packages/ui/src/app/AppShell.tsx:34,195`), which opens one long-lived `EventSource` per
  workspace (`packages/ui/src/api/context.tsx:75-90`).
- `GlobalChatsRoute` *also* wraps every pane in its own `<WorkspaceProvider ws={w.id}
  remember={false}>` (`packages/ui/src/routes/GlobalChats.tsx:38`), and `WorkspaceProvider`
  unconditionally opens a *second*, independent `EventSource` per workspace
  (`packages/ui/src/api/context.tsx:22-33`).

So `/chats` opens **two persistent SSE connections per workspace** before a single ordinary query
(threads, messages, decisions, tickets, workers, projects, conductor, runtimes, usage — each pane
fires off roughly a dozen of these) can run. At the reported 3 workspaces that is already 6
concurrent long-lived connections — exactly Chromium/Firefox/Safari's ~6-connections-per-origin
cap under HTTP/1.1 (confirmed live: the daemon serves HTTP/1.1) — with nothing left in the pool for
the requests that would actually render content. That is why the shell appears (served before the
streams open) and the content never does.

Doubling down on the existing per-pane stream would still fail at a "materially larger" workspace
count even after removing the duplication, since it stays O(number of workspaces). The fix bounds
the page to a small, workspace-count-independent number of live connections instead of raising the
limit.

## What Changes

- Remove the duplicate stream: `/chats` panes no longer each open their own `WorkspaceProvider`
  `EventStream` on top of `FanInStreams`'s.
- Bound live connections to a constant, not one per workspace: exactly one pane — the one the
  human is currently looking at — holds a live workspace-event subscription and a live run-tail
  subscription at a time. The human switches which pane is live by choosing its header (defaults
  to the first workspace). Every other pane still renders that workspace's full conductor chat
  (history, composer, decisions) from ordinary (non-streaming) queries, and catches up the instant
  it becomes the live pane.
- `WorkspaceProvider` gets an optional `live` prop (default `true`, so the per-workspace
  `/w/:ws/chat` route — one pane, one workspace — is unaffected) that skips opening its
  `EventStream` when `false`.
- `ChatPage` gets an optional `focused` prop (default `true`, same reasoning) that gates the
  run-tail stream (`useRunEventStream`) and the "conductor is working" live block, so an
  unfocused pane never opens a run-event `EventSource` either — that stream is independent of
  `WorkspaceProvider`'s and would otherwise still scale with workspace count.
- `/chats` stops rendering `FanInStreams` (superseded there by the one focused pane's own
  subscription); the other four global pages (`/needs`, `/live`, `/incidents`, `/map`) are
  unaffected.
- A regression test drives more workspaces than fit under the connection cap and asserts the
  number of live connections `/chats` opens stays bounded (does not scale with workspace count),
  plus that every pane still shows its workspace's history and switching focus works.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/global-chats`: only the focused pane streams a live turn in real time; the
  human chooses which pane is focused (defaults to the first workspace); an unfocused pane still
  shows history, still accepts sends, and catches up when it becomes focused. This supersedes the
  requirement that every pane always streams live activity for its own workspace regardless of
  which pane the human is looking at.

## Impact

- `packages/ui/src/api/context.tsx` — `WorkspaceProvider`'s new `live` prop.
- `packages/ui/src/routes/GlobalChats.tsx` — focused-pane state, header click target, per-pane
  `live`/`focused` wiring, catch-up refetch on focus change.
- `packages/ui/src/routes/Chat.tsx` — `ChatPage`'s new `focused` prop gating the run-tail stream
  and the live turn block; default keeps `/w/:ws/chat` byte-for-byte behavior.
- `packages/ui/src/app/AppShell.tsx` — stop mounting `FanInStreams` on `/chats`.
- `packages/ui/src/test/globalChats.test.tsx` — extended, not replaced; existing two tests keep
  passing.
- No server or API changes: the connection-count fix is entirely client-side, since no
  multi-workspace SSE endpoint exists to multiplex onto (`GET /api/w/:ws/events` is scoped to one
  workspace — confirmed in `docs/API.md:29`), and adding one is a larger, separately-scoped piece
  of work than this ticket's reported failure requires.
