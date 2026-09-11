## 1. Marker helper and payload bound

- [x] 1.1 In `packages/core/src/tickets/service.ts`, add an exported
  `TICKET_COMMENT_WAKE_BODY_CHARS = 8000` next to the other module constants, with a comment naming
  the deliberate match to `HUMAN_MESSAGE_WAKE_BODY_CHARS` (VS-242) and why (design.md D2). Add a
  `commentWakeBody(body)` helper mirroring `threads/service.ts`'s `wakeBody()`: within the bound
  return `{ body }` with no new keys; over it return
  `{ body: body.slice(0, bound), truncated: true, bodyLength: body.length }`. Add a
  `commentWakeReason(prefix, body)` helper returning the prefix verbatim when `body` fits the bound
  and `${prefix} (truncated; full comment via ac_ticket_comments)` when it does not. Verify by typing
  the module (`pnpm typecheck`) and by the tests in 3.1.

## 2. Apply the marker to every site

- [x] 2.1 In `comment()`, replace the direct worker wake's `body: body.slice(0, 500)` with the
  spread of `commentWakeBody(body)` and build its reason with `commentWakeReason('new comment on ' +
  t.identifier, body)`. Verify with a `packages/core/src/tickets/tickets.test.ts` case: a human
  comment over the bound on a worker's ticket produces a wake payload with `truncated: true`,
  `bodyLength` equal to the full length, a `body` at the bound, and a reason naming
  `ac_ticket_comments`; a comment at or under the bound produces the full body with neither marker
  field and a reason that does not mention the tool.

- [x] 2.2 In `comment()`, replace the `followUp` payload's `body: body.slice(0, 500)` with the same
  `commentWakeBody(body)` spread, so the payload handed to `followUpWithoutWorker()` carries the
  marker. Verify with a test that drives the no-live-worker path (a ticket with an assignee role and
  no worker, using the harness's fake workers service) and asserts the wake the follow-up emits for
  the existing or newly spawned worker carries `truncated: true` and `bodyLength`, and that its
  reason names `ac_ticket_comments` when truncated (spec scenario "An over-bound comment on a
  workerless ticket still carries the marker").

- [x] 2.3 In `followUpWithoutWorker()`, stop cutting the relaunch note silently: build it from the
  full `payload.body` through a bounded helper that appends an inline truncation marker naming
  `ac_ticket_comments` when the excerpt is shorter than the payload body
  (`payload.truncated || payload.body.length > max`), instead of the bare `payload.body.slice(0,
  300)`. Verify with a test asserting the relaunch note for an over-bound reply contains
  `ac_ticket_comments`, and that a short reply's note carries the comment with no marker (spec
  scenario "The relaunch note marks a truncated excerpt").

- [x] 2.4 In `followUpWithoutWorker()`, apply the same inline marker to the conductor's no-role wake
  reason instead of the bare `payload.body.slice(0, 160)`; the reason must name `ac_ticket_comments`
  when cut. Also build the spawned-worker wake reason (line 612) with the same pointer when the
  payload is truncated, so no follow-up wake's reason is silent. Verify with a test driving the
  no-role path (no role on the ticket) asserting the conductor's wake reason names the tool for an
  over-bound reply and does not for a short one (spec scenarios "The no-role wake reason marks a
  truncated excerpt" and "A short reply leaves the prose unchanged").

## 3. Report and gates

- [x] 3.1 Summarize the coverage in the tests: one over-bound and one within-bound case for each of
  the two payload sites, the pointer in the reasons, and both prose markers, each named against the
  spec scenario it verifies; include the concrete long-comment reproduction from the spec
  (`bodyLength: 9000`). State in the report how many slice sites were found (four, across three
  bounds) versus the ticket description's two.

- [x] 3.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm green; paste both suite blocks
  verbatim with their real totals in the report (acceptance criterion 5). Do not sum them, do not
  report one as both.
