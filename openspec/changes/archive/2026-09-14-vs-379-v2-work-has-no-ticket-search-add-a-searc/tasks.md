# Tasks

- [x] 1. `highlightSegments(text, query)` in `packages/ui/src/v2/work/board.ts`: split a title into matched/unmatched segments for a case-insensitive, regex-escaped search term.
- [x] 2. `V2WorkScreen` search state: `q` from `?q=`, debounced ~250ms, driving a `useTickets({ search, project, includeTerminal: true, limit: 300 })` query while the query is non-empty; an empty query falls back to the normal active + finished-window board. Kanban, table and phone list all read the filtered result.
- [x] 3. The search field: V2 markup in the filter row with a magnifier mark, a clear button, `/` to focus from anywhere on the screen and Esc to clear.
- [x] 4. URL sync: typing writes `?q=` with `replace`, keeping the existing `?project=`/`?done=`, so the query survives a remount and back/forward.
- [x] 5. Result feedback: an `N tickets match` count, a search-specific empty state with a clear action, and matched words highlighted in the title on cards, table rows and the phone list.
- [x] 6. Tests in `packages/ui/src/test/v2work.test.tsx`: filters by title, by a description-only match and by identifier; finished tickets appear while searching; `?q=` survives a remount and combines with `?project=`; clearing restores the board; `/` focuses the field.
- [x] 7. Rendered check: V2 Work kanban, table and phone list with a query active, in dark and light, against an isolated scratch daemon. V1 unchanged. `pnpm lint`, `pnpm typecheck` and both suites pass.
