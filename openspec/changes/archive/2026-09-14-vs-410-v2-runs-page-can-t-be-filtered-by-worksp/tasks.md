# Tasks — VS-410

## 1. Server: order the runs list

- [x] 1.1 `RunsService.list` accepts `sort: 'createdAt' | 'cost' | 'duration' | 'tokens'` and
      `dir: 'asc' | 'desc'`; the default stays `created_at DESC` so today's callers are unchanged.
- [x] 1.2 The `ORDER BY` for `cost` reads `cost_cents`, for `tokens` reads the run's
      `usage_json` input+output, and for `duration` reads `finished_at` (or now, while running) minus
      `started_at`. A row missing the key sorts last in both directions; ties fall back to
      `created_at`/`id` for stable paging.
- [x] 1.3 `GET /runs` parses and forwards both parameters, validated as enums; `docs/API.md`
      documents them.

## 2. UI: workspace filter and sort

- [x] 2.1 Add a workspace filter beside the state chips that lists every workspace by name (never an
      internal id). Selecting one fans the runs query out to that workspace only; `All` keeps every
      workspace.
- [x] 2.2 Add a sort control covering cost, duration and tokens, each ascending and descending, with
      a default of most recent first.
- [x] 2.3 Pass the sort/direction to the server query so ordering spans the whole history, and sort
      the merged rows across workspaces with the same comparator.
- [x] 2.4 In-progress runs order by elapsed-so-far duration and by their current cost and tokens.
- [x] 2.5 Keep the workspace filter, state, sort and direction in the URL, restored on reload.

## 3. Tests

- [x] 3.1 Core: `RunsService.list` orders by cost, tokens and duration in both directions, keeps the
      default recency, and puts rows missing the key last.
- [x] 3.2 UI: the workspace filter shows only the chosen workspace's runs; the sort control re-orders
      the table; a URL `ws`/`sort`/`dir` initialises the screen and a change writes it back.

## 4. Verify

- [x] 4.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 4.2 Both suites run and pasted verbatim.
- [x] 4.3 Screenshots from a scratch daemon with runs in at least two workspaces: each sort and the
      workspace filter, in both themes.
