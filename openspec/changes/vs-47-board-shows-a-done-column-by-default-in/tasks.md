## 1. Order finished tickets by when they finished

- [x] 1.1 `sort?: 'number' | 'finished'` on `TicketFilter`, honoured by `tickets.list`
- [x] 1.2 `sort` on `GET /tickets`, documented in `docs/API.md`
- [x] 1.3 Core test: `sort: 'finished'` orders by finish time, default ordering unchanged

## 2. Recent-finished window in the board lib

- [x] 2.1 `finishedAt`, `recentlyFinished`, `FinishedMode` and the `?done=` round-trip helpers
- [x] 2.2 `foldBoard` sorts the Done column newest-finished first
- [x] 2.3 Lib tests for the window, the ordering and the URL round-trip

## 3. Board route

- [x] 3.1 Dedicated finished-ticket query, enabled unless finished tickets are hidden
- [x] 3.2 Done column by default, with its count and a "show all" affordance
- [x] 3.3 Recent / All / Hidden control, labelled and round-tripping through the URL
- [x] 3.4 Table shows the Outcome column whenever a finished ticket is on the board
- [x] 3.5 Route tests: default recent column, expand to all, hide, Outcome column
