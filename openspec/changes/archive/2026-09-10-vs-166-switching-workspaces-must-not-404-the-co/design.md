## Context

See `proposal.md` for motivation. `ChatRoute` (`packages/ui/src/routes/Chat.tsx`)
holds `threadId` in `useState` and the selection effect returns early once any id
is set. TanStack Router reuses the same `/w/$ws/chat` component when only `$ws`
changes, so a chat-to-chat workspace switch keeps A's thread id while `useWs()`
and `useThreadMessages` now target B. `useThreadMessages` enables on a truthy id
and calls `GET /api/w/{B}/threads/{A}/messages` → `not_found`.

Drafts (`draftKey(ws, thread:…)`) and reading position (`chatScroll.ts`) are
already per-workspace. `live`, `sending`, and in-memory attachments are not.

## Goals / Non-Goals

**Goals:**
- A workspace switch never enables the messages query with another workspace's
  thread id — including the first render after `ws` changes.
- After the switch, the chat shows this workspace's web thread or the empty
  composer.
- A `not_found` for a thread that is not in this workspace's list recovers by
  re-selecting/creating, without a document reload.
- A chat test covers the switch.

**Non-Goals:**
- Remounting every workspace route, or changing the router tree.
- Recovering a genuinely deleted thread of the current workspace.
- Telegram / TUI / daemon thread APIs.
- Changing how drafts or reading position are stored.

## Decisions

### Fetch id is derived from this workspace's thread list

Do not pass `threadId` to `useThreadMessages` unless it appears in the current
workspace's `useThreads()` result (or is the id just returned by `useCreateThread`
for this workspace). When `ws` changes, `qk.threads(ws)` is a different query, so
`threads.data` is undefined or B's list — A's id does not match, the messages
query stays disabled, and no 404 fires on that first render.

A `useEffect` that only `setThreadId(null)` on `ws` change is not enough: one
render still has the old id and the new `ws`.

Selection then: if the derived id is set, keep it; else take `threads.data[0]` or
create a web thread, same as today.

### Reset per-session chat state with the workspace

`live`, `sending`, and in-memory attachments belong to the conversation on
screen. Key an inner chat page by `ws` so those reset on switch (an A's in-flight
run must not stream into B's chat). Outer `ChatRoute` reads `useWs()` and renders
`<ChatPage key={ws} />`. Drafts and scroll restore from existing sessionStorage.

The derived fetch id still guards the query if the key is later removed.

### 404 recovery is scoped to a foreign thread

`useThreadMessages` already surfaces `isError`; expose the error enough to read
`ApiError.code === 'not_found'` (or status 404). If that fires and the requested
id is **not** in this workspace's thread list, clear `threadId` and let selection
run. If the id **is** in the list, keep today's ErrorState — out of scope for a
deleted-here thread.

Do not auto-create in a loop: only create when the list loaded empty.

### Tests stay in `chat.test.tsx`

The file mocks `../api/hooks` wholesale. Drive `state.ws`, per-workspace
`useThreads()` data, and record the id passed to `useThreadMessages`. Cover:
switch A→B does not pass A's id after `ws` is B, and a foreign `not_found` clears
through to B's thread without the error card. Existing tests keep `th_1` / `ws1`.

## Risks / Trade-offs

- **Keying by ws remounts the chat, including stick-to-bottom.** → Reading
  position already restores after history loads (`sidebar-workspaces`); keep that
  path. Do not persist `live`/`sending` across workspaces.
- **`threads.data` briefly undefined on switch.** → Messages query disabled;
  skeletons already show when `messages.data === undefined && !isError`. Fine.
- **New hook exports break every route-test mock.** → Do not add a hook; keep
  the logic in Chat. If `useThreadMessages` grows an `error` field, only this
  mock needs it.
- **Create-thread race on a slow list.** → Unchanged from today (`isSuccess` and
  `!isPending`); still only when the list is empty.

## Migration Plan

UI-only. No schema, API, or daemon change. Rollback is revert.
