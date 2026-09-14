## 1. Live model and stream delivery

- [x] 1.1 Add `packages/ui/src/lib/workerActivity.ts` with the pure `mergeWorkerActivity` (pushed frame wins over the workers-read row, including a null activity) and `activityLine` (current activity, else the run summary, else null) helpers, and a unit test covering both precedence rules — verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/workerActivity.test.ts`.
- [x] 1.2 Add `packages/ui/src/api/workerActivity.ts`: a `useWorkerActivity()` hook that subscribes with `useWorkspaceEvents`, buffers `worker.activity` frames into a `Map<agentId, WorkerActivitySummary>` and flushes once per animation frame, with a test that a pushed frame patches the map and the handle is cancelled on unmount.
- [x] 1.3 Add `'worker.activity'` to `TRACKED` in `packages/ui/src/api/events.ts` (widening its type to `(EventType | EphemeralEventType)[]`) and extend `packages/ui/src/test/eventStream.test.tsx` to assert the `EventStream` attaches a `worker.activity` named listener — verify by running that test file.

## 2. V2 Work

- [x] 2.1 In `packages/ui/src/v2/work/Work.tsx`, extend `WorkRow` with the merged live summary from `useWorkerActivity` + `useWorkers`, a run-summary fallback from `useRuns` via `lastLinesByAgent`, and the paused reason from `pausedWorkersByTicket` + `workerPauseDetail`; the screen SHALL load runs for the fallback.
- [x] 2.2 Render the working mark + activity line + test tally on kanban cards above the worker/age hairline, the summary fallback as a plain line, and `paused · <reason>` with no working mark; render the same line on table rows and the phone list.
- [x] 2.3 Extend `packages/ui/src/test/v2work.test.tsx`: a live worker's card shows the working mark, activity line and tally; a pushed `worker.activity` frame updates the line; an idle ticket shows no mark; a paused worker shows its reason and no mark — verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/v2work.test.tsx`.

## 3. V2 ticket page

- [x] 3.1 In `packages/ui/src/v2/ticket/Ticket.tsx`, use `ticketBoardStatus(ticket.status, { live })` for the header glyph and render the live activity line (same helper/hook as Work) under the header metadata while the ticket's worker is live or, between turns, its last run summary.
- [x] 3.2 Extend `packages/ui/src/test/v2ticket.test.tsx`: a running worker's ticket shows the working state and activity line; a pushed `worker.activity` frame updates it; no live worker shows no line — verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/v2ticket.test.tsx`.

## 4. Verification

- [x] 4.1 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`; confirm both suite blocks are green and paste them verbatim in the delivery report (the core/server suite and the UI suite each, never combined).
