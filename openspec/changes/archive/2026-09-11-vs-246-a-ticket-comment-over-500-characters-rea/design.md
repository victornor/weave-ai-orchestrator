## Context

See proposal.md — Why. Current state that shapes the approach:

- `packages/core/src/tickets/service.ts` has **four** `slice` expressions over a comment body, at
  three bounds, all currently silent:
  - `comment()` builds the direct worker wake payload at `body.slice(0, 500)` (line 848) and the
    `followUp` payload passed to `followUpWithoutWorker()` at `body.slice(0, 500)` (line 851).
  - `followUpWithoutWorker()` builds a relaunch note at `payload.body.slice(0, 300)` (line 604) and
    the conductor's no-role wake reason at `payload.body.slice(0, 160)` (line 618).
- The follow-up payload is delivered as a wake payload to a spawned worker (`wake(..., payload)`,
  line 612) and to the conductor (line 618), so it is a payload site, not just an intermediate.
- VS-242 landed the marker convention in `packages/core/src/threads/service.ts`'s `wakeBody()`:
  `{ body }` when within the bound, `{ body: slice, truncated: true, bodyLength: body.length }` when
  over it. `bodyLength` is a JS `.length` (UTF-16 code units), the same unit `.slice(0, N)` uses.
- The `human_message` wake source already uses an 8,000-character bound
  (`HUMAN_MESSAGE_WAKE_BODY_CHARS`, VS-242). A human message on a ticket-bound thread does **not**
  take that path — `threads/service.ts` `inbound()` forwards it to `tickets.comment()` (line 215),
  which is where the 500 bound applies.
- The turn prompt renders a wake as `- <source>: <reason>` (`packages/core/src/prompts/index.ts`
  line 285, `flattenWakes`); the payload itself is read through `ac_inbox`. So a pointer placed in
  the payload alone is not seen unless the agent calls `ac_inbox`; a pointer in `reason` is.
- `ac_ticket_comments` (`packages/server/src/tools.ts` line 298, `scope: 'all'`) already returns
  every comment's full body and is unchanged.

## Goals / Non-Goals

**Goals:**

- Every `ticket_comment` wake payload that carries a cut comment says so, in VS-242's exact shape.
- A reader of the wake is told, without a second call, which tool returns the full comment.
- The two prose excerpts in the follow-up path no longer cut silently.
- One bound for the two payload sites, chosen and argued rather than inherited.

**Non-Goals:**

- Changing the comment store, `ac_ticket_comments`, or any thread behavior (VS-242's capability is
  untouched).
- Removing any bound, or making it configurable.
- Changing wake bundling/coalescing (`wake.enqueue` Gate 3) or `flattenWakes`' rendering.
- Touching `workers.relaunch()`'s own diagnostic `relaunchNote.slice(0, 400)` (line 311, activity
  and event record, never delivered to the worker).
- Adding a tool, route, CLI command, schema or migration.

## Decisions

### D1 — Marker shape: VS-242's `{ truncated: true, bodyLength }`, omitted when not truncated

Both payload sites use one helper mirroring `threads/service.ts`'s `wakeBody()`: within the bound,
return `{ body }` with no new keys; over it, return
`{ body: body.slice(0, B), truncated: true, bodyLength: body.length }`. `bodyLength` is `.length`,
matching the unit `.slice` already measures in.

Alternative considered: add a `readWith: 'ac_ticket_comments'` payload field. Rejected — it invents a
second marker convention the ticket explicitly forbids, and the pointer belongs on the reason line
(D3).

### D2 — One payload bound, raised from 500 to 8,000; the two prose bounds stay

The two payload sites carry the same comment body to a worker — one directly, one via the follow-up —
so they share a single named bound, `TICKET_COMMENT_WAKE_BODY_CHARS`. It rises to 8,000 to match
`HUMAN_MESSAGE_WAKE_BODY_CHARS` (VS-242): the same human prose written on the same channel, which
today gets 8,000 through the `human_message` path on a free thread and 500 through the
`ticket_comment` path on a ticket-bound one. The marker plus `ac_ticket_comments` is what makes any
bound safe (the same argument VS-242 used), so the number only has to be a reasonable default, not a
guarantee.

The two prose excerpts (300, 160) are **not** the comment body; they are one-line summaries inside a
larger wake whose own reason line is rendered into every turn prompt. They keep their lengths and
gain an inline marker instead, so a snippet stays useful without inflating every prompt line to
8,000 characters. The marker fires when the excerpt is shorter than the text it summarises —
`payload.truncated || payload.body.length > max` — not only when the payload itself was truncated, so
a 400-character comment cut to 300 is still marked.

Alternative considered (bounds): leave the payload at 500. Rejected — the ticket frames 500 as
smaller than the 2,000 VS-242 replaced, and the same message already gets 8,000 one path over.
Alternative considered: remove the bound. Rejected — an unbounded body in a coalesced bundle is the
opposite failure, and the payload is stored, not just rendered.
Alternative considered: import `HUMAN_MESSAGE_WAKE_BODY_CHARS` rather than declare a local constant.
Rejected — it would couple the ticket-comment bound to a constant documented for the conductor's
thread context; a local constant with a comment naming the deliberate match keeps the two able to
diverge later without one silently changing the other.

### D3 — The pointer lives in the wake `reason`, not the payload

`flattenWakes` renders `- <source>: <reason>` into the turn prompt, so the reason is what a worker
reads before it calls anything. When the payload is truncated, the reason becomes
`new comment on VS-246 (truncated; full comment via ac_ticket_comments)` (and the follow-up's
reasons likewise). An untruncated wake keeps today's reason verbatim. The payload still carries
`truncated`/`bodyLength`, so `ac_inbox` is self-describing too.

Alternative considered: rely on the payload marker alone and document the tool in
`ac_ticket_comments`'s own description. Rejected — acceptance criterion 4 asks that a worker reading
the marker be pointed at the tool, and a worker with a fragment has no reason to open a tool.

### D4 — The prose marker names the tool and, when known, the original length

The relaunch note and no-role reason append an inline marker such as
`… (truncated; full comment via ac_ticket_comments)` when cut. The payload's `bodyLength` is not
always available to the prose path (a comment within the payload bound but over the excerpt's has no
`bodyLength`), so the marker names the tool rather than a number the string cannot know. This keeps
the prose honest without inventing a per-excerpt length field.

## Risks / Trade-offs

- Adding fields to stored wake payloads is additive JSON; no reader parses the payload schema
  strictly, and wakes written before this change simply lack the keys. Only the reason line changes
  for a truncated wake, and only truncated ones.
- A worker on the follow-up path that ignores reason lines still sees `truncated`/`bodyLength` in
  `ac_inbox`; the pointer is belt-and-braces, not the only signal.
- Raising the bound to 8,000 raises the ceiling on a coalesced bundle of comment wakes; acceptable
  per Non-Goals and identical to the trade-off VS-242 already accepted for `human_message`.
- The prose marker changes two user-visible strings; tests asserting those strings verbatim must be
  updated, and no spec requirement depends on their exact wording beyond naming the tool.
