# Board shows a Done column by default

## Why

The board hid every finished ticket behind an "active / all" switch the workspace owner never
found. With the Done column filtered out, a day in which many tickets landed looked identical to
a day in which nothing did.

## What changes

- The board's finished-ticket control becomes three explicit choices — **Recent** (default),
  **All**, **Hidden** — still round-tripping through `?done=` (`1` keeps meaning "all", `0` hides).
- Recent means the last 7 days, capped at the 20 newest, ordered by when each ticket finished.
- The Done column carries a count and a "show all" link that widens it to the full terminal set.
- The table view shows the same tickets, with the Outcome column present whenever a finished
  ticket is on the board.
- Finished tickets get their own query (`status=done,cancelled&sort=finished&limit=100`) so they
  cannot be pushed out by the 300 active ones. `GET /tickets` gains `sort=finished`, which orders
  by `COALESCE(completed_at, cancelled_at, updated_at)` — a ticket's number says when it was
  filed, not when it landed.

## Non-goals

Archiving or deleting old tickets.
