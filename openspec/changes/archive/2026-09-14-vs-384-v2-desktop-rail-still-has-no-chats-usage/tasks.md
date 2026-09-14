# Tasks

## 1. The rail registry carries the kept screens

- [x] 1.1 In `nav.ts`, add an optional `rail?: boolean` to `V2Dest` and set it on `global-chats`, `ws-usage` and `ws-changelog` in `V2_KEPT`; leave `ws-graph` and `ws-explorer` unmarked.
- [x] 1.2 Export `V2_RAIL_EVERYWHERE` (Needs you, Live, Chats, then the rest of `V2_EVERYWHERE`) and `V2_RAIL_WORKSPACE` (`V2_WORKSPACE` followed by Usage and Changelog), both derived from the existing arrays and the `rail` flag.

## 2. Both desktop rails render them

- [x] 2.1 In `V2Shell.tsx`, render the expanded rail's Everywhere group from `V2_RAIL_EVERYWHERE`.
- [x] 2.2 In `V2Shell.tsx`, render each workspace group's rows from `V2_RAIL_WORKSPACE`.
- [x] 2.3 In `V2Shell.tsx`, render the collapsed 48px rail's global stretch from `V2_RAIL_EVERYWHERE` and its workspace stretch from `V2_RAIL_WORKSPACE`, leaving the phone tab bar and the More list on `V2_EVERYWHERE`/`V2_KEPT`.

## 3. Tests

- [x] 3.1 Extend `v2nav.test.ts`: `V2_RAIL_EVERYWHERE` is Needs you, Live, Chats, Incidents, Map, Runs, Scheduled, Settings in that order; `V2_RAIL_WORKSPACE` is Chat, Needs you, Work, Roles, Knowledge, Usage, Changelog and contains neither `ws-graph` nor `ws-explorer`.
- [x] 3.2 Extend `v2shell.test.tsx`, `describe('the rail carries the kept V1 screens')`: in the expanded rail Chats links to `/v2/chats` and Usage and Changelog link to `/v2/w/acme/usage` and `/v2/w/acme/changelog`; on each of those routes exactly one rail row is highlighted and it is that row; the same three links exist in the collapsed rail.

## 4. Green checks, rendered check and delivery

- [x] 4.1 `pnpm lint`, `pnpm typecheck`, and both test suites green; paste both suite blocks verbatim in the report.
- [x] 4.2 Render the expanded and collapsed rails in dark and light at desktop width with at least two workspaces; confirm the three entries are visible and correctly highlighted, and list what was checked.
- [x] 4.3 Open the PR, record it as a work product, and transition the ticket to `in_review`.
