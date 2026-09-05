## Why

The merge queue is currently a floating card dropped into the middle of the Board's scrolling body (`packages/ui/src/routes/Board.tsx:161-168` renders `MergeQueuePanel` with `className="m-4 mb-0"`, above the columns). It has margin on three sides and none below, it is the only card on a page otherwise built out of full-bleed columns and rows, and it exists only while the board happens to be filtered to a single project — so the same page looks structurally different depending on a filter that has nothing to do with landing. The workspace owner's words: "it has no spacing below it and it's ugly. Redesign it entirely, either on a different tab or whatever."

The panel is also thin on substance. It lists position, identifier, title, a badge and an age, and nothing else: not how many slots the project's `mergeConcurrency` gives it, not how long the ticket at the front has been landing, no way into the merge turn's transcript, and no memory at all — a queue that just emptied looks identical to one that never had anything in it, so the most common question ("did VS-53 land?") cannot be answered here.

## What Changes

- **The merge queue gets its own route**, `/w/:ws/merge-queue`, showing one project at a time (`?project=<id>`, with a project switcher when the workspace has more than one). It is the full picture: what is landing now with elapsed time and a link into the merging worker's transcript, who is waiting in order with position and age, how many of the project's merge slots are in use, and the last few tickets that landed or failed with their outcome and when.
- **The floating card leaves the Board.** In its place, a quiet one-line **strip inside the Board's existing filter bar** — same container, same horizontal padding as the filters above it — reads `Merge queue · 1 landing · 2 waiting →` and links to the route. It is derived from the board's own ticket data (`status === 'merging'`, split by `mergeStartedAt`), so it needs no extra query and, unlike the card, it is present at every board filter, saying "nothing landing" when the queue is empty. Nothing floats among the columns any more.
- **The daemon reports recent queue outcomes.** `GET /projects/:id/merge-queue` gains `recent: MergeQueueOutcome[]` — the last few tickets that left the project's queue, each with `outcome` (`landed`, `failed`, `withdrawn`), the time, and the merge commit where there is one. It is derived from the `activity` rows the ticket service already writes (`ticket.merged`, and `ticket.transition` / `ticket.cancel` out of `merging`); no schema change, no new writes.
- **The empty state is designed, not blank.** With nothing merging or waiting, the route says so in one line and still shows the recent landings underneath, so the page always answers "did it land?".
- **The ticket page's merge badge becomes a link** into the new route for that ticket's project. Its existing shape and text are unchanged.
- **`MergeQueuePanel` is removed** — nothing renders it once the Board strip and the route exist — and `MergeQueueBadge` stays.
- **The contract docs follow the placement.** PLAN §11.4 currently says the queue is readable "on the board and ticket pages"; that sentence becomes the strip, the route and the ticket page. DESIGN-CONTRACT §3/§5 gain the route as a screen reached from the Board rather than a rail destination, with the reasoning.

## Capabilities

### New Capabilities

(None. The merge queue already has a capability; what changes is what it reports and where the web app shows it.)

### Modified Capabilities

- `ticket-delivery/merge-queue`: the requirement "The merge queue is reportable with each ticket's position" gains the recent outcomes the report carries and states that the web application shows the queue in a place of its own rather than inside the board, with an entry point that does not depend on a filter; a new requirement covers what that view must answer in each of its states (landing, waiting, recent, empty).

## Impact

- `packages/core/src/api.ts` — `MergeQueueOutcome`, and `recent` on `MergeQueueView`.
- `packages/core/src/tickets/merge-queue.ts` — `recentOf(projectId)`, read from `activity` joined to `tickets`; `forProject` returns it.
- `packages/core/src/tickets/merge-queue.test.ts` — outcomes after a merge, after a failed merge, after a withdrawal, and the ordering/limit.
- `packages/server/test/app.test.ts`, `packages/server/test/fakes.ts` — the route's new field.
- `docs/API.md` — the `GET /projects/:id/merge-queue` shape.
- `packages/ui/src/api/types.ts`, `hooks.ts` — `MergeQueueOutcome`, `recent`; `useMergeQueue` unchanged in shape.
- `packages/ui/src/routes/MergeQueue.tsx` (new), `packages/ui/src/router.tsx` — the route.
- `packages/ui/src/components/MergeQueue.tsx` — `MergeQueueStrip` and the section components replace `MergeQueuePanel`; `MergeQueueBadge` gains an optional link target.
- `packages/ui/src/routes/Board.tsx` — the card goes, the strip joins the filter bar.
- `packages/ui/src/routes/TicketPage.tsx` — the badge links.
- `packages/ui/src/test/components.test.tsx`, `boardRoute.test.tsx`, `mergeQueue.test.tsx` (new) — the landing, waiting, recent and empty states, the strip, and the board no longer carrying a panel.
- `docs/PLAN.md` §11.4, `docs/design/DESIGN-CONTRACT.md` §3 and §5.

## Out of scope

- How the queue itself works: ordering, `mergeConcurrency`, admission, landing verification and the merge turn are untouched.
- The CLI's `conductor ticket merge-queue` table, which keeps printing active and waiting exactly as it does; the new `recent` field is additive and it ignores it.
- The TUI, which has no merge-queue screen today.
- A cross-project "everything landing in the workspace" view. The queue is per project by definition (PLAN §11.4) and the route switches between them; a combined view would be a different design question.
