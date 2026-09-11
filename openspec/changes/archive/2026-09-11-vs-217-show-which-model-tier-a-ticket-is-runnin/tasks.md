## 1. The tag component

- [x] 1.1 Add `packages/ui/src/components/WorkerModelTag.tsx` with `workerModelTagLabel(ticket, options)` and `WorkerModelTag({ticket, options})` per design.md: hidden unless `(options?.length ?? 0) > 1`; the ticket's `workerModelId` when the catalog contains it; `default` when the id is null or dangling; rendered as a neutral `Badge`. Verify with a pure test asserting all six branches: zero options → hidden; one option → hidden; two options + matching id → the id; two options + `workerModelId: null` → `default`; two options + an id absent from the catalog → `default`; and that the gate is derived — passing a one-element array vs a two-element array of the same options flips visibility.

## 2. Board

- [x] 2.1 `TicketCard`/`TicketRow` gain `workerOptions?: WorkerModelOption[]`; the tag renders in the card's badge row after the kind badge and in the row's meta line after the identifier. No existing prop, element or class changes.
- [x] 2.2 `Board.tsx` calls `useModels()` once and threads `models.data?.workerOptions` into `TicketCard`, `TicketRow` and the table's Kind cell (Kind column width `6rem` → `9rem` while tags show). Verify in `boardRoute.test.tsx` (its hooks mock gains `useModels`): with two options, a kanban card, phone row and table row each show their ticket's id; with one option, none do.
- [x] 2.3 Verify in `components.test.tsx`: direct `TicketCard` render with two options shows the id, with `workerModelId: null` shows `default`, with one option shows no tag; every pre-existing assertion in the file passes with no edits to those tests.

## 3. Live view

- [x] 3.1 `LiveCell` gains `workerOptions?`; the ticket-identity row becomes link (truncating, `min-w-0`) + `flex-none` tag. `LiveRoute` calls `useModels()` and passes the options. Verify in `liveFloor.test.tsx` (its hooks mock gains `useModels`): a cell shows its ticket's id with two options; no tag with one.
- [x] 3.2 Verify smallest-cell rendering: `LiveCell` at `{cols: GRANULARITY, rows: GRANULARITY}` renders the tag while agent name, ticket link and status badge all remain present (structural, jsdom-safe). Screenshot the smallest cell via the no-daemon harness; leave the images as uncommitted files and post the absolute paths on the ticket. (Done at the true minimum `{cols:1, rows:1}` of 12 — smaller than the default slot; the link gained a `min-w-10` floor so it stays readable beside the tag.)
- [x] 3.3 Global Live agrees with workspace Live: add `useModelsMany(ids)` to `packages/ui/src/api/hooks.ts` (a `useQueries` fan-out over `qk.models(ws)`, mirroring `useWorkersMany`) and thread each workspace's options into its `LiveCell`s in `GlobalLive.tsx`. Verify in `globalLive.test.tsx` (its mock gains `useModelsMany`).

## 4. Verification

- [x] 4.1 `pnpm lint && pnpm typecheck && pnpm test` green at the repo root; paste the actual output summary on the ticket. (lint + typecheck green; ui suite green 83 files / 1359 tests; core suite green except the documented `engine.test.ts` auth-retry flake, which fails the same way on untouched `main` and passes in isolation — evidence on the ticket.)
- [x] 4.2 Confirm nothing on the card moved or shrank: the pre-existing `components.test.tsx` card tests pass unmodified (acceptance 6), and the 3.2 screenshots show the card/cell layout intact at the smallest size.
