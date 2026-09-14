# V2 Work can search tickets

Tracker change for [VS-379](weave://tickets/VS-379). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

V2 Work (`packages/ui/src/v2/work/Work.tsx`) shows a workspace's tickets as kanban, table or phone
list, with project / role / kind / priority filters. It has no text search, so the only way to find
an older ticket — including one that already finished and left the recent window — is to scroll the
columns and read every card.

The daemon already has the search: `packages/core/src/tickets/service.ts` applies `filter.search` as
`title LIKE ? OR description LIKE ? OR identifier LIKE ?`, the HTTP tickets list passes `search`
through, and `useTickets` accepts it. Finished tickets are excluded unless `includeTerminal` is set.

## What changes

- **A search field in the filter row** (V2 primitives): a magnifier mark, a clear button, `/` to
  focus from anywhere on the screen, Esc to clear.
- **Server-backed filtering, debounced ~250ms.** A non-empty query drives a `useTickets` call with
  `search` (and the active project), so matches in descriptions and in tickets outside the loaded
  page are found. The kanban, the table and the phone list all read the same filtered set.
- **Finished tickets are included while a query is active** (`includeTerminal: true`); they fold
  into the Done column, which is fine for a table grouped by column too. An empty query restores the
  normal board window exactly as it is today.
- **The address keeps the query** (`?q=`, `replace` so typing does not stack history), so it
  survives reload and back/forward, and combines with the existing `?project=`.
- **Result feedback:** a `"N tickets match"` count, a search-specific empty state with a clear
  action, and the matched text highlighted in a ticket's title on cards, rows and the phone list.

## Out of scope

V1 (`/w/$ws/board`) is unchanged. No new daemon route: the existing list `search` is sufficient.
Searching comments, documents or run transcripts is not part of this.
