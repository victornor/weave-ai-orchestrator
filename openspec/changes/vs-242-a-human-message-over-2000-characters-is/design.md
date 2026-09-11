## Context

See proposal.md for why. Constraints that shape the approach:

- `packages/core/src/threads/service.ts` `inbound()` builds the `human_message` wake payload inline
  at the `wake.enqueue` call (around line 203): `body: body.slice(0, 2000)` plus `projectId`,
  `projectSlug`, reply fields, and optional `attachmentIds`. Only reached when the thread is not
  ticket-bound — a ticket-bound thread's message lands as a ticket comment instead (a separate,
  already-scoped truncation, out of this change).
- Several human messages that arrive before a turn dispatches coalesce into one `queued` wake, the
  rest folded into `payload.bundle` (wake.enqueue Gate 3, per the 2026-09-08 knowledge entry). A
  bundle can carry several of these payloads at once, which is why the bound stays a bound rather
  than being removed — this change does not touch the bundling or its own size limits.
- The wake row is stored (not just rendered) — `packages/server/src/tools.ts` `ac_inbox` reads it
  back through `bundledWakes`/`flattenWakes` unchanged; nothing in that path currently expects
  truncation fields, so adding them is additive and cannot break an existing reader.
- `ThreadsService.attachment(threadId, attachmentId)` is the existing precedent for a by-id read
  scoped to its thread: the query itself filters on `thread_id`, so a cross-thread id and an unknown
  id return the identical `not_found` — no separate "wrong thread" branch that would let a caller
  distinguish "exists elsewhere" from "does not exist" (an oracle leak). `message()` follows the
  same shape.
- `messages(threadId, opts)` already knows how to attach a `replyToExcerpt` via a self-join and to
  read full rows with `db.all<ThreadMessage>(...)` — column names come back camelCased already, no
  separate row-mapper exists for `ThreadMessage` (unlike `channel_threads`, which has `threadRow`).
  `message()` reuses that same join, `db.get` instead of `db.all`, filtered to one id.
- `ac_human_send` is the existing `scope: 'conductor'` MCP tool operating on threads
  (`packages/server/src/tools.ts`). Threads are the conductor's domain — a worker's claims carry no
  thread id — so the new read tool takes the same scope.
- `ac_ticket_document_get` (`packages/server/src/tools.ts`) is the existing pattern for a by-id read
  tool that throws `not_found` with a helpful payload rather than a bare error; `ac_thread_message_get`
  follows the same tone but has no equivalent "list of available keys" to offer.

## Goals / Non-Goals

**Goals:**

- A truncated `human_message` wake payload is self-describing: `truncated: true` and `bodyLength`.
- An untruncated payload is byte-for-byte what it is today, with no new fields.
- The full body of any thread message is reachable by id, through a documented tool, without
  touching the database file.
- A reasoned, larger bound (8,000 chars, from 2,000).

**Non-Goals:**

- Removing the bound, or making it configurable.
- Changing wake bundling/coalescing (`wake.enqueue` Gate 3) or its own size limits.
- Fixing the same silent-slice shape in `ticket_comment` wakes (`tickets/service.ts` `comment()` and
  `followUpWithoutWorker()`, both `body.slice(0, 500)`) — flagged in the report per the ticket's
  acceptance criteria, not fixed here: unlike a thread message, a ticket comment's full body is
  already reachable through the existing `ac_ticket_comments` tool, so the risk this ticket exists
  to close does not apply there the same way.
- Attachments, the bootstrap digest, or any other wake source.
- A row-mapper (`threadMessageRow`) for `ThreadMessage` generally — `message()` returns what
  `db.get<ThreadMessage>` already gives back, matching `messages()`'s existing pattern.

## Decisions

### D1 — Marker shape: `truncated: true` + `bodyLength`, present only when truncated

`bodyLength` is measured in JS string `.length` (UTF-16 code units), the same unit `.slice(0, N)`
already uses — consistent with the number a reader would need to reconstruct "how much of this am I
missing" without introducing a second unit (bytes) that would need its own justification. Both
fields are omitted entirely (not `truncated: false`) when the body is within the bound, per
acceptance criterion 2 — "no new fields that would read as truncation." A reader checks
`payload.truncated` truthiness; its absence and `false` are equivalent for that check, so nothing
downstream needs to change to tolerate the new fields.

Alternative considered: match `runs/engine.ts`'s `boundPayload` shape (`{ truncated, bytes, preview
}`) exactly. Rejected — that function replaces the *entire* payload with a wrapper object when
serialized JSON exceeds a size limit (a different mechanism protecting a different thing: total
event-log entry size, not one field). Reusing its field names here without its replace-the-whole-
object behavior would suggest a shared implementation that does not exist and invite a future
"just call boundPayload" refactor that conflates two different bounds.

### D2 — Bound raised to 8,000 characters

2,000 was never argued for; it is small next to how captain actually writes (paste of a report, a
stack trace, a spec section — the ticket's own trigger was 11,064 characters, and the description
notes "2,000 characters is small for how captain actually writes"). 8,000 is a 4x increase:
comfortably covers a long paragraph-form message or a short pasted document without the marker,
while a bundle of, say, 5 coalesced messages near the bound stays around 40KB of payload JSON — the
same order of magnitude the wake/payload storage already handles elsewhere (e.g. `runs/engine.ts`'s
own `PAYLOAD_LIMIT`). The exact number is not load-bearing for correctness now: the marker plus
`ac_thread_message_get` is what makes any bound safe, so 8,000 only has to be a reasonable default,
not a guarantee, and can be revisited later from real traffic without another correctness fix.

Alternative considered: remove the bound. Rejected per the ticket explicitly — an unbounded payload
inside a coalesced bundle is the failure mode on the other side.

### D3 — `message()` scoped by thread, not workspace-global by message id alone

Requiring `threadId` (which the wake payload always carries) mirrors `attachment(threadId, id)` and
keeps the same-workspace, same-thread invariant enforced by the query itself rather than by a
separate authorization check — consistent with how `repliedToMessage` and `attachment` already
reason about cross-thread/cross-workspace access in this file's existing comments.

## Risks / Trade-offs

- Adding `bodyLength`/`truncated` to a stored wake payload is additive JSON; no existing consumer
  reads those key names, so there is no migration concern for wakes already persisted before this
  change ships (they simply have no such fields, same as any other pre-change payload).
- Raising the bound to 8,000 slightly raises the ceiling on a coalesced bundle's total size; left
  unaddressed here per Non-Goals, since the ticket scopes bundling out and the existing bundle has
  no size cap of its own today regardless of this change.
