## 1. The queue report carries what recently left it

- [x] 1.1 `MergeQueueOutcome` (`ticketId`, `identifier`, `title`, `outcome: 'landed' | 'failed' | 'withdrawn'`, `at`, `mergeCommit`) and `recent: MergeQueueOutcome[]` on `MergeQueueView` in `packages/core/src/api.ts`; `pnpm typecheck` names every place that must now supply it.
- [x] 1.2 `recentOf(projectId, limit = 5)` in `packages/core/src/tickets/merge-queue.ts`, derived from `activity` joined to `tickets` per design D3 (`ticket.merged` → landed, `ticket.transition`/`ticket.cancel` out of `merging` → failed or withdrawn), one row per ticket, most recent first; `forProject` returns it.
- [x] 1.3 Tests in `packages/core/src/tickets/merge-queue.test.ts`: a completed merge reports `landed` with its commit, a merge that blocked reports `failed`, a ticket sent back reports `withdrawn`, order is most-recent-first, the limit holds, and a project with no history reports `[]`.
- [x] 1.4 `GET /projects/:id/merge-queue` documented with `recent` in `docs/API.md`, and `packages/server/test/app.test.ts` asserting the field is served; verify with the server suite.

## 2. The route

- [x] 2.1 `MergeQueueOutcome` and `recent` in `packages/ui/src/api/types.ts`; `useMergeQueue` unchanged in shape and still keyed by project.
- [x] 2.2 `packages/ui/src/routes/MergeQueue.tsx`: header with the project `Segmented` (only when the workspace has more than one project), the landing / waiting / recent sections and the slots-in-use line, per design D5; project read from `?project=` through `useSearchParams`, falling back to the first project for a missing or unknown id, and written back on a switch.
- [x] 2.3 The route registered at `/w/$ws/merge-queue` with `searchPassthrough` in `packages/ui/src/router.tsx`; verify it renders through the app's router in a test rather than only as a component.
- [x] 2.4 Landing entries link to the merging worker's transcript (`/w/$ws/workers/$workerId`) and every ticket named anywhere in the view opens its ticket page; loading, error and empty states use `SkeletonRows`, `ErrorState` and a worded empty line that keeps the recent section visible.

## 3. The board points at it

- [x] 3.1 `mergeStrip(tickets)` in `packages/ui/src/lib/board.ts` returning the landing and waiting counts from ticket `status`/`mergeStartedAt`; unit-tested for the merging, waiting, both and none cases.
- [x] 3.2 `MergeQueueStrip` rendered inside the Board's filter bar container per design D5, present at every filter and worded for the idle case; `MergeQueuePanel` and `useMergeQueue` removed from `Board.tsx`.
- [x] 3.3 `MergeQueuePanel` deleted from `packages/ui/src/components/MergeQueue.tsx`; `MergeQueueBadge` gains an optional link target and the ticket page passes it, with its existing rendering unchanged when the target is absent.

## 4. Cover it

- [x] 4.1 `packages/ui/src/test/mergeQueue.test.tsx`: the merging state (elapsed time, slots in use, the log link), the waiting state (order and positions), the recent state (all three outcomes), the empty state (worded, recent still shown), and the project switch writing the URL.
- [x] 4.2 `packages/ui/src/test/components.test.tsx` and `boardRoute.test.tsx` updated: the panel's tests replaced by the strip's (counts, idle wording, link target), the board asserted to render no queue panel, and `MergeQueueBadge` covered with and without a link target.
- [x] 4.3 `pnpm lint`, `pnpm typecheck`, `pnpm test` and the ui suite all green (the ui suite run separately as well as through the root chain).

## 5. The contract follows the placement

- [x] 5.1 `docs/PLAN.md` §11.4: the queue is readable at `GET /projects/:id/merge-queue`, as `conductor ticket merge-queue`, on its own page in the web app, and on the ticket page — replacing "on the board and ticket pages".
- [x] 5.2 `docs/design/DESIGN-CONTRACT.md` §3 and §5: the merge queue page listed as a screen reached from the board's filter bar and the ticket page, with the reason it is not a rail destination (design D2) written down.
- [x] 5.3 Screenshots of the merge queue page at desktop and phone widths attached to the PR, per the ticket's acceptance criteria.
