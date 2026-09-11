## Why

`packages/core/src/tickets/service.ts` cuts a comment into its `ticket_comment` wake payload at
500 characters with no marker and no original length. A worker woken by a human correction reads the
first 500 characters and has no reason to suspect there is more — nothing in the payload, and no
`…`. It is the same silent-and-terminal shape VS-242 fixed for thread messages at 2,000 characters,
one path over, and it is reachable: unlike a thread message, `ac_ticket_comments` already returns the
full comment, but a worker holding what looks like a whole comment has no reason to call it.

VS-242's worker found **four** slice expressions in this file, not the two the ticket description
named, across three distinct bounds (500, 300, 160). All four are in scope; none should cut
silently, and the marker shape must be the one VS-242 landed — `truncated: true` plus `bodyLength`
(the original character count) — not a second convention.

## What Changes

- **The two wake payload sites carry the VS-242 marker.** Both `comment()`'s direct wake and the
  `followUpWithoutWorker()` payload (delivered to an existing worker or a freshly spawned one) carry
  `truncated: true` and `bodyLength` when the comment exceeds the bound, and are byte-for-byte
  unchanged — no new fields — when it does not.
- **The two prose sites stop cutting silently.** `followUpWithoutWorker()` builds a relaunch note
  (`body.slice(0, 300)`) and a no-role wake reason (`body.slice(0, 160)`); each gains an inline
  truncation marker naming `ac_ticket_comments` when it is shorter than the comment it summarises.
- **The reader is pointed at the full body.** `ac_ticket_comments` (already `scope: 'all'`) returns
  the whole comment; the wake `reason` line that reaches the worker names it when the payload was
  cut, so a worker reading a fragment knows both that it is a fragment and what to call.
- **The payload bound rises from 500 to 8,000 characters**, matching
  `HUMAN_MESSAGE_WAKE_BODY_CHARS` (`packages/core/src/threads/service.ts`, VS-242). A ticket-bound
  human message and a non-ticket-bound one are the same text written by the same human, but the
  ticket path truncates 16× earlier; the marker makes either number safe, so the two paths should
  agree. The two prose bounds are left as-is — see design.md D2.

## Capabilities

### New Capabilities

- `ticket-lifecycle/ticket-comment-truncation`: a `ticket_comment` wake payload states when its body
  was cut and how long the original comment was; an unaffected comment carries no new fields; a
  reader of a truncated payload is pointed at `ac_ticket_comments` for the full body; every payload
  site carries the marker, and the two prose summaries embedded in a follow-up wake are marked
  inline rather than cut silently.

### Modified Capabilities

None.

## Impact

- `packages/core/src/tickets/service.ts` — a named comment bound and a marker helper shared by both
  payload sites; the marker on `comment()`'s wake and on the `followUpWithoutWorker()` payload; an
  inline truncation marker on the relaunch note and the no-role wake reason.
- Tests: `packages/core/src/tickets/tickets.test.ts` — over-bound comment marks both payload sites
  with `truncated`/`bodyLength`; within-bound comment carries neither field; the follow-up note and
  reason name `ac_ticket_comments` when cut; a reproduction at a concrete long length.
- No schema, tool, route or CLI change. `ac_ticket_comments` is unchanged.
- The existing `ticket_comment` wake readers (`flattenWakes` in `packages/core/src/prompts/index.ts`,
  `ac_inbox` in `packages/server/src/tools.ts`) ignore unknown payload keys, so the added fields are
  additive and cannot break a stored wake written before this change.
