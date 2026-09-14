## Why

On V2, a ticket being worked on looks the same as one sitting idle: Work cards, table rows and the
ticket page carry no sign that a worker is running and no line saying what it is doing. Captain
reported this on 2026-09-13 — "there's no sign that a ticket is being worked on right now". V1 already
answers both halves of the question (the amber working mark on a live worker's card, and the current
activity line), and the daemon already computes and streams the data V2 needs. V2 simply renders
none of it.

## What Changes

- **Work (kanban cards, table rows and the phone list).** A ticket whose worker is live shows the
  amber working mark and the worker's current activity line — the running command, the test in
  progress or the last tool call — with the most recent test tally when the daemon has parsed one.
  The line updates from the workspace event stream as new activity arrives. Between turns it falls
  back to the worker's last reported run summary. A ticket with no live worker shows no working
  mark; a paused worker shows `paused · <reason>` instead.
- **The ticket page.** While the ticket's worker is live, the header shows the same working state and
  activity line near the top, without the user opening a run or its transcript.
- **The event stream actually delivers the frame.** `worker.activity` is broadcast by the daemon as
  an ephemeral SSE frame, but the web client's `EventStream` only attaches listeners for the types in
  its `TRACKED` list, which omits `worker.activity` — so neither V1's existing board listener nor any
  new V2 listener receives it today. The type is added to `TRACKED`. This is a `packages/ui`-only
  change; no daemon, route or payload changes.
- **Reuse, no new surface.** The line and state are derived from `useWorkers` (whose rows already
  carry the daemon's `WorkerActivitySummary`), `useRuns` via the existing `lastLinesByAgent`, the
  existing `worker.activity` stream, and the existing `ActivityLine` / `TestTally` / `workerPauseDetail`
  helpers. No API or daemon change. V1's screens are not redesigned.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `web-v2/work`: adds live worker status — the working mark, the current activity line, the test
  tally and the between-turns run-summary fallback — to cards, table rows and the phone list, fed by
  the existing workers read and workspace event stream.
- `web-v2/ticket-page`: adds the same live working state and activity line to the page header while
  the ticket's worker is running.

## Impact

- `packages/ui/src/lib/workerActivity.ts` (new) — pure helpers: merge a pushed `WorkerActivitySummary`
  over the workers-read row, and choose the line to display (current activity, else last run summary).
- `packages/ui/src/api/workerActivity.ts` (new) — the hook that buffers `worker.activity` frames,
  coalesced to one state update per animation frame, and exposes the override map to the screens.
- `packages/ui/src/api/events.ts` — `worker.activity` added to `TRACKED` so the existing event stream
  delivers it to component listeners (`invalidateFor` already no-ops for it).
- `packages/ui/src/v2/work/Work.tsx` — cards, table rows and the phone list render the working mark,
  the activity line, the test tally and the paused reason.
- `packages/ui/src/v2/ticket/Ticket.tsx` — the header renders the live working state and line.
- `packages/ui/src/test/` — new/extended tests for the pure helpers, the stream subscription, V2 Work
  and the V2 ticket page.
- `docs/API.md` — unchanged: no route, payload or event type is added.
