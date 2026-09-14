# A held V2 decision card stops lying about the revision

Tracker change for [VS-430](weave://tickets/VS-430). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

A V2 held card (`packages/ui/src/v2/DecisionCard.tsx`) claims a revision is underway whenever the
weaver's review carries concerns, without looking at the worker. On 2026-09-14 captain saw VS-381's
merge card pulse `Revision in progress · 17h` for a worker that was paused waiting on an npm
publish; the clock counted from the weaver's review, not from anything the worker did.

The same card's Watch pane opens the shared `WorkerFeed` (`packages/ui/src/v2/WorkerFeed.tsx`).
When a card passes its asking `runId`, the feed's status line is pinned to `runId ? null : …`, so it
always reads `No run yet` — above the run transcript it is actually rendering below.

## What changes

- **The revision row reflects the worker's real state.** A small pure helper maps the ticket's
  worker status, its latest run and the ticket's own status to one of:
  - a running turn → a pulsing `Revision in progress`, timed from that run's start;
  - a worker between turns with no live run → a non-pulsing `Held for a revision — waiting on the
    worker`, with the time since its last activity;
  - a paused worker → `Held — worker paused`, with the pause reason when one is available;
  - a blocked ticket → `Held — blocked: <blocker>`;
  - no worker → `Held — no worker`.
  Only a turn actually running pulses. The card reads the ticket's detail (its worker, its status,
  its blockers) and the worker's current run; no new prop is added to the two call sites.
- **The Watch status line describes the run the feed shows.** `WorkerFeed` labels the run it
  resolved and renders — its status plus when it ended (`Succeeded · 16h ago`) — and renders
  `No run yet` only when there is truly no run to describe.
- **Tests.** A unit test covers each worker state of the row; a card render test proves it uses the
  helper; a feed test covers a card whose `askedInRunId` resolves to a finished run.

## Out of scope

- Approve button styling (VS-422).
- The compact card type (VS-418).
- V1's decision card: V2 only.
