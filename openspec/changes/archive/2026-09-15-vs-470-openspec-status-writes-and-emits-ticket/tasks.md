# Tasks — VS-470

## 1. Skip no-change writes

- [x] 1.1 `packages/core/src/openspec/index.ts`: export `canonicalJson()` — JSON with object keys sorted recursively, arrays in order — and in `statusFor()` compare the computed status with the ticket's stored `openspecState`; when equal, return the status without the `db.update`, the `updatedAt` bump or the `ticket.updated` emit. Verify: `pnpm typecheck` clean.
- [x] 1.2 `packages/core/src/openspec/service.test.ts`: two identical `statusFor()` calls produce exactly one `tickets` update and one `ticket.updated` emit; a changed task count produces a second emit; a stored status that differs only in object key order is not a change. Verify: `./node_modules/.bin/vitest run packages/core/src/openspec/service.test.ts` green.

## 2. Name the caller and measure

- [x] 2.1 Identify and record the caller in the delivery: the ticket-detail `GET /tickets/:id` route, re-entered by the `ticket.updated` its own `statusFor` emits (`ui/src/api/events.ts` invalidates `qk.ticket`). Write it as a ticket `report` document.
- [x] 2.2 On a scratch daemon, open a ticket page carrying an OpenSpec change for 60 s and paste the `ticket.updated` count for that ticket, before and after the fix. Verify: the after count is a small constant, not thousands.

## 3. Suites and lint

- [x] 3.1 `pnpm lint && pnpm typecheck` clean.
- [x] 3.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report.
