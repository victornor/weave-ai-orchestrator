# Tasks

- [x] 1. Page the thread history: `useThreadMessages` becomes an infinite query over `before`/`limit` with a 30-message page, flattening pages oldest-first and reporting `hasOlder` / `isLoadingOlder` / `loadOlder`.
- [x] 2. Let the chat own its scroll container: `PageBody` takes a ref. (Landed in VS-38 as `scrollRef`; VS-39 uses it as-is.)
- [x] 3. Fold the paging behaviour into VS-38's `useStickToBottom` rather than a second hook over the same container: the opening jump is instant, reaching the top asks for the older page, and a layout effect holds the viewport by distance-from-bottom while that page is prepended.
- [x] 4. Wire `ChatRoute` to both, with a loading row above the history and no further requests once history ends.
- [x] 5. Tests: initial position at the bottom without animation, an older page loading with the viewport anchored, end-of-history stopping further loads, and VS-38's follow tests still green alongside them.
