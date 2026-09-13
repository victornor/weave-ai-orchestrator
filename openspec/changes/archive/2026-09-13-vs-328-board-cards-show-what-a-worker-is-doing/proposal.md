## Why

A working card on the board only pulses its status glyph: to learn whether the worker is editing a
file, running the tests or stuck reading, the human has to open the ticket. Captain wants a one-line
live activity and, where it can be got honestly, the latest test tally on the card itself — the
signal every other orchestrator's kanban already carries.

## What Changes

- The daemon derives a short, human activity line for every live worker from its current run's latest
  tool call or phase (`Editing TicketCard.tsx`, `Running tests`, `Reading code`), across every
  runtime's event shape, with a generic `Working` fallback. It also parses the latest test tally
  (`38/60 tests`) from the worker's most recent test command, supporting the common runners generally
  and showing nothing when no summary can be parsed — never a guessed number.
- Both are carried on the workers query (so a fresh page load is already correct) and pushed live on
  the workspace event stream the board already consumes, throttled per worker, with **no per-card
  EventSource**. The last parsed tally survives a turn ending until a newer test command replaces it;
  the activity line is present only while the worker is running.
- The board's `TicketCard` and `TicketRow` render the line (`✎ Editing TicketCard.tsx · 12s`, a
  spinner and a relative time) and the test tally (green when all pass, warning-toned otherwise) in
  the existing card density, truncating rather than growing the card.
- When a ticket has an open pull request whose check rollup is non-empty, the card shows the PR
  number and state and the passed/total checks (`Checks 5/6`), read from the check tally the daemon
  now keeps on the ticket's delivery record. Projects without CI show nothing.
- **BREAKING**: none.

## Capabilities

### New Capabilities

- `worker-supervision/worker-activity`: the daemon-side derivation of a live per-worker activity line
  and latest test tally from run events — the cross-runtime tool-to-verb mapping, the test-summary
  parsers for the common runners, how the summary is exposed on the workers read and pushed cheaply
  on the workspace stream, and how the last tally survives a turn ending.
- `workspace-navigation/board-activity`: how the board's kanban card and phone row render the live
  activity line, the latest test tally and an open PR's checks, and how they degrade when a value is
  unknown.

### Modified Capabilities

- `ticket-delivery/delivery-record`: adds that the delivery record carries the pull request's
  rolled-up check state and passed/total counts, refreshed when the daemon reconciles the PR.

## Impact

- `packages/shared` — the activity summary and test-tally shapes, the new ephemeral workspace-frame
  type, and the pure test-summary parser (shared so runtime adapters can parse before output is
  truncated).
- `packages/render` — the pure tool-to-verb/activity mapper, beside the existing transcript target
  helpers.
- `packages/runtimes/*` — each adapter parses a test tally from its command output before the 8 KB
  truncation and carries it on the `command.executed` event.
- `packages/core` — a new `WorkerActivityService` on `CoreServices`, fed by the run engine; the
  ephemeral `EventBus` broadcast; the forge check tally persisted through the supervisor reconcile.
- `packages/plugin-sdk` / `packages/core/src/forge/gh.ts` — `prState` returns the check tally.
- `packages/server` — `GET /workers`/`GET /workers/:id` carry the summary; the workspace SSE route
  forwards the ephemeral activity frames; `docs/API.md` updated.
- `packages/ui` — `TicketCard`/`TicketRow`, the Board route's activity subscription, and tests.
- No database migration: the tally rides `delivery_json`; the activity summary is derived in memory.
