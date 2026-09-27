## 1. Backend: forward pagination

- [x] 1.1 Add an `after` cursor to `ThreadsService.messages()` (`packages/core/src/threads/service.ts`), mirroring `before` (ascending `created_at > ?`, no reverse needed); verify with a core test asserting `after` returns the messages strictly newer than the cursor, oldest-first.
- [x] 1.2 Add `after` to the `GET /threads/:id/messages` route (`packages/server/src/routes/threads.ts`), rejecting it combined with `before` or `around`; verify with a route/service test for the validation error and a happy-path forward page.

## 2. Backend: literal-match search

- [x] 2.1 Add a shared `needsLiteralMatch(query)` predicate and `literalSnippet(body, needle, contextChars)` builder in `packages/core/src/search/` (next to `ftsQuery.ts`); verify with unit tests: `needsLiteralMatch('_password')` true, `needsLiteralMatch('password')` false, and a snippet test asserting the exact literal substring is wrapped in `\u0002…\u0003`.
- [x] 2.2 Wire the helper into `ThreadsService.search()`: when `needsLiteralMatch` is true, over-fetch FTS candidates (capped at the existing `SEARCH_MAX_LIMIT`), filter to a case-insensitive literal substring match on the message body, build the snippet via `literalSnippet`, then slice to the requested limit; verify with a core test that a thread containing both `_password` and a `password`-only message returns only the `_password` one for that query, and that plain `password` still returns both.
- [x] 2.3 Verify ordering stays newest-first for thread search after the literal filter, with a test covering two literal matches at different times.
- [x] 2.4 Apply the same helper to `SpecsService.search()` (`packages/core/src/specs/index.ts`) if it fits without changing the return shape; run its existing test suite and confirm nothing regresses, or note in a ticket comment why it was skipped if it does not fit cleanly.

## 3. Frontend: bidirectional thread history

- [x] 3.1 Extend `useThreadMessages` (`packages/ui/src/api/hooks.ts`) with an optional `anchor: string | null` parameter: `anchor == null` keeps today's tailing query key/behavior unchanged (verify existing thread-history tests still pass unmodified); a non-null anchor uses a distinct query key and seeds the first page via the `around` read.
- [x] 3.2 Add forward paging to the same hook via `getPreviousPageParam`/`fetchPreviousPage` (`after` cursor from the newest loaded message), exposing `hasNewer`, `isLoadingNewer`, `loadNewer()` alongside the existing `hasOlder`/`isLoadingOlder`/`loadOlder()`; verify with a hook test that `loadNewer()` extends the loaded list forward and `hasNewer` becomes false once a short page comes back.
- [x] 3.3 Remove `useMessageContext` and its query key, folded into the above.

## 4. Frontend: conversation scrolling both ways

- [x] 4.1 Add a `NewerPages` counterpart to `OlderPages` in `packages/ui/src/lib/stickToBottom.ts`, with a `NEAR_BOTTOM_PX` trigger in the scroll handler that calls `loadNewer()` when near the bottom of the loaded window and `hasNewer` is true; verify with a `stickToBottom.test.tsx` case that scrolling near the bottom with `hasNewer: true` calls `loadNewer`.
- [x] 4.2 Thread the `newer` option through `ChatConversation`'s call to `useStickToBottom`, accepting a `newer` prop shaped like the existing `older` one.
- [x] 4.3 Expose `jumpTo(id: string)` on `ChatConversationHandle`, generalizing the existing internal `onJumpTo` so an external caller can trigger the same scroll-and-highlight; verify with a component test that calling the handle's `jumpTo` scrolls to and highlights the named message once it is rendered.

## 5. Frontend: wire the search result into the normal view

- [x] 5.1 In `ChatPage.tsx`, pass the chosen anchor into `useThreadMessages(fetchId, anchor)` and thread `hasNewer`/`isLoadingNewer`/`loadNewer` into `ChatConversation`'s `newer` prop.
- [x] 5.2 On `SearchPanel`'s `onSelect(messageId)`: if the message is already in the loaded list, call the conversation handle's `jumpTo` directly; otherwise set it as the anchor and, in an effect keyed on the anchor and the loaded message ids, call `jumpTo` once the target id appears in the rows.
- [x] 5.3 Add a small "Jump to latest" convenience control, shown only while an anchor is set, that clears the anchor and returns the view to the tailing query, scrolled to the bottom.
- [x] 5.4 Delete `JumpView` and its now-unused imports/props from `ChatPage.tsx`.
- [x] 5.5 Rewrite the `v2chat.test.tsx` jump test ("jumps the conversation to a chosen search result") to assert the target message renders inside the normal scrollable conversation (highlighted, in view), not a separate banner; add a test that scrolling up and back down from a jumped-to message loads older and newer messages without losing position in the same view.

## 6. Verification and evidence

- [x] 6.1 Run the full test suite (`pnpm test`) and paste both the core/server and UI suite result blocks in the delivery report.
- [x] 6.2 Run `pnpm lint && pnpm typecheck`.
- [x] 6.3 Capture light- and dark-theme screenshots of: opening a search result deep in history, scrolled up past it, and scrolled back down to the latest message, all in the same view; attach them to the ticket with `weave_ticket_attachment_put` before requesting review.
