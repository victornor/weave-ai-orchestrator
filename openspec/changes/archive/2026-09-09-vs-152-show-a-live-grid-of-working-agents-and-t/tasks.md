## 1. Navigation: Live is a workspace section

- [x] 1.1 Add Live to `RAIL` in `packages/ui/src/app/nav.ts` between Board and Team, `to: '/w/$ws/live'`, `kbd: '4'`; shift Team–Knowledge to `5`–`8` and keep Settings on `,`. Pick a `glyph` from the existing set (prefer `working`).
- [x] 1.2 Add Live to `MORE_ITEMS` (rail leftovers plus merge-queue) with a one-line hint, so the phone More menu lists it and the leftover-pin test stays true.
- [x] 1.3 Register `/w/$ws/live` in `packages/ui/src/router.tsx` pointing at the new route component.
- [x] 1.4 Update `workspacenav.test.tsx` (expanded group lists Live in rail order), `moreSheet.test.tsx` (More lists Live), `router.test.tsx` (the route is registered). The five phone tabs stay five.

## 2. Membership and the page

- [x] 2.1 Add a helper next to `isLiveWorker` in `packages/ui/src/lib/board.ts` that returns the live workers on a ticket (`kind === 'worker'`, `isLiveWorker`, has `ticketId`), newest `createdAt` first. Unit-test: running included, paused/idle/retired/conductor/no-ticket excluded, two live workers on one ticket both returned.
- [x] 2.2 `packages/ui/src/routes/Live.tsx`: `PageHeader title="Live"`, `meta` = count of working cells; body is a responsive grid of cells from that helper over `useWorkers` + ticket join via `useTickets`. Gate loading on `data !== undefined`.
- [x] 2.3 Empty / loading / error: `EmptyState` when the loaded set is empty (no paused/historical fill-in); skeleton grid while pending; `ErrorState` with retry on workers-query failure.

## 3. Each cell streams

- [x] 3.1 Cell header: `agent.name`, ticket identifier and title as a link to `/w/$ws/tickets/$ticketId`. No steer/attach/resume/pause/cancel.
- [x] 3.2 Resolve the cell's in-progress run from `useRuns({ status: 'running' })` (and queued if that list is separate), indexed by `agentId`. Mount `useRunEventStream(runId, { live: true })` only while that run is active; `RunTranscript` with a cell-sized max-height and `contained` stick-to-bottom.
- [x] 3.3 A live worker with no in-progress run still renders the header and a between-turns placeholder, not an omitted cell.

## 4. Cover it

- [x] 4.1 `packages/ui/src/test/liveFloor.test.tsx`: several live workers → that many cells; paused/idle/conductor excluded; empty wording; loading vs empty; ticket link target; a fake EventSource opened for a running worker's run and not for a between-turns worker; a `worker.status` / run-finished update that drops a cell does not require a remount (query data change is enough).
- [x] 4.2 `docs/PLAN.md` §21.1 rail list includes Live (between Board and Team) with its keyboard number; phone bar remains five tabs, Live reached from More.
- [x] 4.3 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` all green.
