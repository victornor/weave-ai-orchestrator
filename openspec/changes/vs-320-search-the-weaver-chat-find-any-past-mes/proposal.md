## Why

The primary weaver thread holds 2,062 messages going back to 2026-09-04, loaded 50 at a time with a
`before` cursor and lazily paged further back on scroll. Finding an earlier decision or link today
means scrolling back through days of history by hand. Search exists elsewhere in the app (knowledge,
specs, the board) but not in the chat, and a client-side filter would only ever see the page or two
already loaded — this has to run over the stored messages, server-side.

## What Changes

- Add a full-text index over `thread_messages`: a new FTS5 virtual table (`thread_message_search`),
  populated by a migration backfill for existing rows and kept current by indexing every new
  inbound/outbound message as it is written.
- Extract the plain-text query sanitiser `ftsQuery()` (today private to `packages/core/src/specs/index.ts`)
  into a small shared module both the specs search and the new message search import, so there is
  still exactly one implementation.
- Add `ThreadsService.search(threadId, query, opts)`, scoped to one thread in one workspace the same
  way `messages()` and `message()` already are — a thread id from another workspace resolves to
  `not_found`, matching the existing convention rather than inventing a new one. Expose it as
  `GET /threads/:id/search?q=`.
- Add `ThreadsService.around(threadId, messageId, opts)` and extend `GET /threads/:id/messages` with
  an `around` query param: a window of messages centered on a given message id, oldest-first, so a
  search result far outside the currently loaded window can be jumped to without paging back one
  screen at a time.
- Add a search affordance to the weaver chat (a button reachable on both desktop and phone layouts,
  plus a `⌘⇧F` / `Ctrl⇧F` shortcut scoped to the chat view — never the bare find shortcut, so the
  browser's own find-in-page is untouched). Results are newest first, each showing author, timestamp
  and a highlighted snippet, with a clear empty state.
- Selecting a result switches the message list into an "anchored" view: it loads the window around
  that message, scrolls it into view, and highlights it briefly. A single "back to latest" control
  discards the anchored view and returns to the normal tailing view, where new messages continue to
  arrive exactly as they do today (unchanged pagination/stick-to-bottom code path).

## Capabilities

### New Capabilities
- `conductor-chat/message-search`: full-text search over one thread's stored messages, newest first,
  with author/timestamp/highlighted snippet, safe against FTS5 operator characters in plain-text
  queries, scoped to one thread in one workspace, backed by an index kept current from creation.
- `conductor-chat/message-jump`: selecting a search result (or otherwise navigating to a known
  message id) loads that message's surrounding history into the chat, scrolls to it, highlights it
  briefly, and offers one action back to the live tail — without disturbing how new messages arrive
  once back there.

### Modified Capabilities
(none — no existing capability's requirements change; `scroll-follow`'s tailing behavior is
explicitly preserved, not altered, once the human returns to it)

## Impact

- `packages/db/src/migrations/0033_thread_message_search.sql` (new) — FTS5 table + backfill. Not
  `0032`: VS-316 has already claimed that number on an unpushed branch (see design.md — Migration
  Plan).
- `packages/core/src/search/ftsQuery.ts` (new) — sanitiser moved out of `specs/index.ts`.
- `packages/core/src/specs/index.ts` — imports the moved `ftsQuery` instead of defining it.
- `packages/core/src/threads/service.ts` — index-on-write, `search()`, `around()`.
- `packages/core/src/api.ts` — `ThreadsService` interface additions.
- `packages/shared/src/types.ts` — `ThreadSearchResult` type (and any type needed for the `around`
  window response).
- `packages/server/src/routes/threads.ts` — `GET /threads/:id/search`, `around` param on the existing
  messages route.
- `packages/ui/src/api/hooks.ts`, `packages/ui/src/api/keys.ts` — search + jump-to-message hooks.
- `packages/ui/src/routes/Chat.tsx` and a new search panel component — the affordance, results list,
  anchored view, "back to latest" control.
- Tests across `packages/core/src/threads/*.test.ts`, `packages/server` route tests, and
  `packages/ui/src/test/chat.test.tsx`.
- No change to run traces, worker transcripts, or other workspaces' chats (explicitly out of scope).
