## 1. Shared query sanitiser

- [x] 1.1 Move `ftsQuery()` from `packages/core/src/specs/index.ts:147` into a new
      `packages/core/src/search/ftsQuery.ts`, update `specs/index.ts` to import it from there, and
      verify `pnpm --filter @weave-ai/core exec vitest run` still passes the existing specs-search
      tests unchanged (pure relocation, no behavior change).

## 2. Message search index

- [x] 2.1 Rebase the branch onto `main` and add `0033_thread_message_search.sql` — **not** the next
      free number a plain listing of `main` would suggest: VS-316 has an approved plan already
      claiming `0032_…` on a branch that isn't pushed yet (see design.md — Migration Plan). Use
      `0033` even if `main` still looks like `0032` is free. Re-confirm nothing else has claimed
      `0033` immediately before delivery (task 7.2). The file: `CREATE VIRTUAL TABLE
      thread_message_search USING
      fts5(message_id UNINDEXED, thread_id UNINDEXED, workspace_id UNINDEXED, body)` plus one
      `INSERT INTO thread_message_search SELECT ... FROM thread_messages JOIN channel_threads JOIN
      channels` backfilling every existing message with its thread and workspace id. Verify
      `packages/db/src/migrations.test.ts`'s migration-set test still passes and a fresh database
      built from all migrations contains the backfilled rows for a fixture with pre-existing messages.
- [x] 2.2 In `packages/core/src/threads/service.ts`, index each message into
      `thread_message_search` inside `insertMessage()`'s existing transaction (both the `inbound` and
      `outbound` call sites), storing the same `workspace_id` `get(threadId)` already resolves.
      Verify a unit test: sending a message through `inbound`/`outbound` makes it immediately
      findable via the new search path added in task 3.1, with no separate reindex call.

## 3. Search service and route

- [x] 3.1 Add `ThreadsService.search(threadId, query, opts?: { limit?: number })` to
      `packages/core/src/api.ts` and implement it in `packages/core/src/threads/service.ts`: resolve
      the thread via the existing `get(threadId)` (so a cross-workspace id throws the same
      `not_found` `messages()`/`message()` already throw), sanitize `query` with the relocated
      `ftsQuery()`, `MATCH` against `thread_message_search` filtered to `thread_id` (and
      `workspace_id` as a belt-and-suspenders filter), order newest first, and return
      `snippet(...)`-highlighted results with author/timestamp joined back from `thread_messages`.
      Add `ThreadSearchResult` to `packages/shared/src/types.ts`. Verify unit tests: a match older
      than the first page is found; operator characters (`"`, `*`, `-`, `:`, `(`, `)`) never error;
      a query matching a message in another thread, or a thread in another workspace, returns
      nothing/`not_found` as appropriate; a backfilled (pre-existing) message is found; an empty
      query or no-match query returns an empty list, not an error.
- [x] 3.2 Add `GET /threads/:id/search?q=&limit=` to `packages/server/src/routes/threads.ts`,
      validating `q` as a required non-empty string the same way other routes in this file validate
      query params. Verify a route-level test hitting the endpoint end to end (through the HTTP
      layer, not just the service) for a happy-path match and for the cross-workspace `not_found`
      case.

## 4. Jump-to-message read path

- [x] 4.1 Add `ThreadsService.around(threadId, messageId, opts?: { before?: number; after?: number
      })` to `packages/core/src/api.ts` and implement it in `service.ts`: resolve the thread via
      `get(threadId)`, look up the target message scoped to that thread the same way `message()`
      does (`not_found` if it does not exist in this thread), then fetch up to `before` messages at
      or before it and up to `after` messages strictly after it, merged oldest-first — reusing
      `messages()`'s existing `(created_at, rowid)` ordering, not `created_at` alone: `messages()`
      breaks ties on `rowid` because two messages can share a `created_at` (a relayed answer and its
      echo are written together), and comparing `created_at` alone here would risk dropping the
      target from its own window or repeating/skipping a neighbour. Verify unit tests: the target
      message itself is included in the window; a target near the very start or very end of a thread
      returns a shorter window rather than erroring; a target id from another thread is `not_found`;
      two messages sharing the same `created_at`, one of them the target, still produces a correct
      window (no duplicate, no drop).
- [x] 4.2 Extend `GET /threads/:id/messages` in `packages/server/src/routes/threads.ts` with an
      optional `around` query param that, when present, calls `around()` instead of `messages()` (and
      keep the two mutually exclusive with `before` in the same request — reject or ignore `before`
      when `around` is set, matching the design's read-path separation from ordinary paging). Verify
      a route test for the `around` param returning the expected window.

## 5. Search UI

- [x] 5.1 Add `useThreadSearch(threadId, query)` and a `qk.threadSearch(ws, id, query)` entry to
      `packages/ui/src/api/hooks.ts` / `keys.ts`, debounced client-side, calling the new `/search`
      route. Verify a hook-level test covers the debounce and the empty-query no-op case.
- [x] 5.2 Add a search panel component (button reachable in `Chat.tsx`'s header on both the desktop
      and the narrow/phone layout — see the existing `narrow` check at `Chat.tsx:297` — plus the
      `⌘⇧F` / `Ctrl⇧F` shortcut via `useHotkeys`, scoped to fire only while the chat view is
      mounted): a text input, a newest-first results list showing author, timestamp, and a
      highlighted snippet (render the highlight as a React element from the snippet's delimiters,
      never `dangerouslySetInnerHTML`), and a distinct empty state for a query with no matches.
      Verify a component test exercises typing a query, seeing results (or the empty state), and
      that operator characters in the input don't break the request.

## 6. Jump-to-message UI

- [x] 6.0 Before starting, check whether VS-321 (lost text selection, also working in
      `routes/Chat.tsx`) has landed on `main`; rebase onto it if so, and re-read its diff to confirm
      the ref-map approach below attaches to rendered message rows rather than replacing/remounting
      them, so it composes with whatever VS-321 changed instead of undoing it.
- [x] 6.1 Add a one-shot `useMessageContext(threadId, messageId)` query hook (not another
      `useInfiniteQuery`) calling the new `around` param, and wire selecting a search result to it:
      `Chat.tsx` renders the returned window in place of the tailing view when a jump is active, adds
      a ref-map-based scroll-to + brief highlight-class toggle for the target message (a plain
      `Map<messageId, HTMLElement>` populated by a ref callback per rendered row — do not reuse
      `useOnScreenDecisions`/`register`, which is decision-card-specific), and shows a single "back to
      latest" control that discards the jump state and returns to rendering the existing, unmodified
      `useThreadMessages` result. Verify component tests: selecting a result for a message outside
      the loaded window renders it (via the mocked `around` response) and scrolls/highlights it;
      selecting a result for an already-loaded message scrolls/highlights without discarding loaded
      history; "back to latest" returns to the tailing view.
- [x] 6.2 Verify a regression test that, after using "back to latest," a new message arriving behaves
      exactly as today's stick-to-bottom tests already assert (extend
      `packages/ui/src/test/chat.test.tsx`'s existing follow-the-bottom assertions to run once more
      after a simulated jump-and-return, rather than writing a parallel duplicate suite).

## 7. Verification and delivery

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and both `pnpm test` suites (core/server and
      `packages/ui`) and paste both totals verbatim in the PR description — per this project's
      standing rule, never report only one suite's numbers as covering both.
- [x] 7.2 In the PR description, re-confirm `0033` is still the right migration number at delivery
      time: check whether VS-316 (`0032_…`) has landed on `main` by then, and whether anything else
      has claimed `0033` in the meantime. Do not re-derive the number from a plain listing of `main`
      alone — see design.md, Migration Plan.
