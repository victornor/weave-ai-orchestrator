## Context

See `proposal.md` — Why. VS-14 (`conductor-chat/message-project-context`, merged as `909dea3`) solved the
structurally identical problem for the project reference, so this change follows its shape deliberately
rather than inventing a second one. The parts of the existing system this design leans on, all verified in
the tree:

- An inbound human message is one row and one wake. `ThreadsService.inbound` inserts a `thread_messages`
  row and, for an unbound thread, enqueues a `human_message` wake with
  `payload: { threadId, messageId, body, projectId, projectSlug }`
  (`packages/core/src/threads/service.ts:115`–`:140`). A thread bound to a ticket takes the other branch
  and becomes a ticket comment instead (`:127`).
- `ac_inbox` returns each wake's `payload` verbatim (`packages/server/src/tools.ts:144`). Anything added to
  the payload reaches the conductor with no change to the tool and no change to any agent-facing schema.
- `thread_messages` already carries one optional, validated, nullable reference — `project_id`, added by
  migration `0004` and resolved before the write so a bad reference stores nothing and wakes nobody
  (`packages/core/src/threads/service.ts:120`). This change is the same mechanism with a different target.
- `Db.camel` maps `snake_case` columns and aliases to camelCase (`packages/db/src/db.ts`), and
  `messages()` selects `*` (`packages/core/src/threads/service.ts:158`), so a new `reply_to_message_id`
  column and a `reply_to_excerpt` alias reach the API response as `replyToMessageId` and `replyToExcerpt`.
- Thread messages are never deleted: there is no `DELETE FROM thread_messages` anywhere in the tree, and
  nothing archives or prunes them. A reference from one message row to another can therefore not dangle.
- `messages()` is a paged read — `ORDER BY created_at DESC, rowid DESC LIMIT ?`, default 50, with a
  `before` cursor (`:158`–`:167`). The client cannot assume the referenced message is in the page it holds.
- `ChatRoute` posts through `usePostThreadMessage` or, when offline, through
  `enqueue({ kind: 'thread', path, body })`, which replays the body verbatim
  (`packages/ui/src/routes/Chat.tsx:174`–`:202`, `packages/ui/src/lib/queue.ts`).
- `Composer` accepts one `scope` node rendered above the input (`packages/ui/src/components/Composer.tsx:159`).
  VS-14 put the project selector there; `scope` is a `React.ReactNode`, so it takes both controls.

## Goals / Non-Goals

**Goals**

- Carry one optional reply reference from the chat to the conductor's inbox, with no new endpoint, no new
  event type, no new agent tool and no new client-side storage.
- Make the reference a first-class column, queryable and legible in the database, exactly as
  `project_id` is.
- Make the quote renderable from the replying message alone, so it does not depend on the referenced
  message being in the page the client loaded.
- Keep every existing caller — Telegram, the CLI channel, the TUI chat, the core tests — working unchanged
  by making the field optional at every layer.

**Non-Goals**

- No threading. One reference, one level, no chain followed, no tree rendered, no grouping of a thread's
  messages by what they answer.
- No reply on worker messages on tickets, in Telegram, or in the CLI chat. The service is general enough
  to allow it; only the web conductor chat offers the control.
- No change to how the conductor uses the reference. Its prompt, charter and skills are untouched; this
  change only makes the fact available.
- No editing or deleting of messages, which is what would make a stored copy of the quoted text go stale.

## Decisions

### 1. A nullable `reply_to_message_id` column on `thread_messages`, not a field inside `parts_json`

Migration `0006` adds `reply_to_message_id TEXT REFERENCES thread_messages(id)` to `thread_messages`,
nullable, no backfill, no index, no `ON DELETE`.

*Alternative considered: store the reference inside the existing `parts_json` blob.* Rejected for the same
reason VS-14 rejected it (ADR 0005): `parts_json` is the CanonicalMessage content of the message (PLAN §13),
not a place for routing metadata; nothing could query it and every reader would have to know a private key
name. The reference is a scalar relationship between two rows and belongs in a column.

The self-referencing foreign key is safe because thread messages are never deleted — there is no delete
path for them in the tree — so no `ON DELETE` clause is needed and none is added, matching `project_id`.
No index: nothing queries messages *by* the message they reply to; the only read is a join from the
replying row, which uses the primary key on the other side.

`0005` is taken by VS-20's merge queue, which is on `main`, so this migration is `0006`. PLAN §6 enumerates
the `thread_messages` columns, so this addition gets an ADR under `docs/adr/`, per the repo's own checklist.

### 2. Validate against the same thread, inside the write transaction, before the insert

`inbound` resolves the reference with a single lookup scoped to the thread it is writing to —
`SELECT id, body FROM thread_messages WHERE id = ? AND thread_id = ?` — and throws `not_found` when there
is no row. Because the resolution happens inside `tx(db, …)` before `insertMessage`, a bad reference stores
nothing and wakes nobody, which is the spec's rejection scenario, achieved by ordering rather than by
cleanup. This mirrors decision 2 of VS-14's design exactly.

Scoping the lookup to the thread rather than checking existence and then comparing is what makes a
cross-thread reference — and therefore a cross-workspace one, since a thread belongs to exactly one
workspace's channel — impossible rather than merely checked: the query cannot return a row from another
thread. It is also the lookup that produces the excerpt, so validation and excerpt are one read.

*Alternative considered: validate in the HTTP route with a Zod refinement.* Rejected, as in VS-14: the
route is one of several entry points into `inbound`, and the invariant "a stored reply reference names a
message of the same thread" belongs to the service that owns the row.

*Alternative considered: restrict the reference to outbound (conductor) messages in the service.* Rejected:
the service has no reason to care, and the restriction is a property of the control, not of the data.
Keeping the service general means the same column serves a ticket-thread reply later without a migration,
while the spec still pins the web chat to conductor messages.

### 3. The excerpt is derived at read time, not stored

`ThreadMessage` gains two fields: `replyToMessageId` (the stored column) and `replyToExcerpt` (derived).
`messages()` adds `LEFT JOIN thread_messages r ON r.id = m.reply_to_message_id AND r.thread_id = m.thread_id`
and selects `r.body AS reply_to_excerpt`, bounded in JS to `REPLY_EXCERPT_CHARS` after the query. The join
repeats the thread predicate so the read enforces the same invariant the write does, rather than trusting
it. `replyToExcerpt` is `null` whenever `replyToMessageId` is.

*Alternative considered: store the excerpt in a second column at write time.* It needs no join. Rejected:
it duplicates text that already exists one row away, and a stored copy is a second thing that can be wrong.
The read-time join has one source of truth by construction.

*Alternative considered: return only the id and let the chat resolve the text from the messages it already
holds.* Rejected on a concrete failure: `messages()` is paged at 50, so a reply to a question from earlier
in a long conversation would render with no quote after a reload — which the acceptance criteria rule out.
Doing it in the client would also need a second fetch or a widened page, both larger than one `LEFT JOIN`.

**The bound is 500 characters**, one exported constant used by both the read path and the wake payload.
It is enough to identify any conductor question unambiguously, it keeps a paged read of 50 messages from
growing without bound when many of them are replies, and it is well under the existing `body.slice(0, 2000)`
the payload already applies to the message's own text. The excerpt is a locator, not a transcript: the
conductor holds the full message in its own session, and the chat clamps the quote visually anyway.

### 4. The wake payload gains `replyToMessageId` and `replyToExcerpt`; `ac_inbox` is not touched

`payload: { threadId, messageId, body, projectId, projectSlug, replyToMessageId, replyToExcerpt }`, with
both new fields `null` when there was no reply — explicitly present rather than absent, so the conductor
can tell "no reply" from an older daemon's payload. This is VS-14's decision 3, applied again.

*Alternative considered: leave the payload alone and let the conductor read the message row.* Rejected:
there is no agent tool that returns thread messages, so the conductor would have no way to reach it.

The wake's `reason` string is deliberately **not** changed. VS-14 put the project slug there because it is
a short, stable token; an excerpt of a message body is neither, and `reason` is rendered in the wake list
and the run log where a truncated sentence would be noise. The reference lives in the payload, which is
where `ac_inbox` delivers it.

### 5. The reply control is a per-message button; the quote renders in the composer's `scope` slot

`ChatRoute` holds one piece of state: the id of the message being replied to, or `null`. The reply control
on each conductor message sets it; choosing another message overwrites it, which gives "replaces rather
than accumulates" for free. A dismiss control on the quote sets it back to `null`, and so does a successful
send — both online and offline, so the next message is never silently attributed to the same question.

The quote renders through `Composer`'s existing `scope` slot, which VS-14 already uses for the project
picker. `scope` is a `React.ReactNode`, so the chat passes a fragment holding the quote (when there is one)
above the picker. No new `Composer` prop, and therefore no new contract on the two other places that
component is used.

*Alternative considered: a new `replyTo` prop on `Composer`.* Rejected for now, on VS-14's reasoning:
`Composer` is shared by the chat, ticket comments and decision notes, and a new prop is a new contract on
all three for something only one of them uses. `scope` already means "what this message is about".

The quoted text in the composer comes from the message the human clicked, which is on screen by definition.
The quote on an already-sent message comes from `replyToExcerpt`, which is why decision 3 exists.

The `Composer` line in `docs/design/DESIGN-CONTRACT.md` gains the reply quote, so the visual contract keeps
matching what ships.

### 6. The offline path needs no change

`enqueue` stores `{ path, body }` and the flush replays the body verbatim. Putting `replyToMessageId` into
the body the chat already builds is the entire offline story — the queue, its storage format and its flush
are untouched. A queued reply whose referenced message was somehow removed would fail on flush like any
other rejected write; since messages are never deleted, it cannot happen.

## Risks / Trade-offs

- **A `LEFT JOIN` on the hottest read in the chat** → It is a primary-key lookup on the joined side, at
  most one row per message, on a table already scanned by `thread_id`. No new index, no fan-out, and the
  excerpt is bounded before it leaves the service.
- **The excerpt is truncated and could cut mid-sentence** → It is a locator, not the message. The
  conductor also receives `replyToMessageId`, and the chat clamps the quote visually regardless of length.
- **One reference, no threading** → Deliberate, and stated as a non-goal. The column admits a chain
  (a reply to a reply is representable) but nothing follows one, so a future threading change is additive
  and needs no migration.
- **A reply reference on a ticket-bound thread reaches nobody in particular** → The reference is stored on
  the message either way; the ticket-comment branch is unchanged, and the comment body is unchanged. The
  web chat only offers the control on conductor messages in the unbound conductor thread, so this is a
  service-level capability with no UI in front of it yet, not a half-built feature.
- **An older daemon reading a newer database** → The column is additive and nullable; an older build's
  `SELECT *` carries a field it ignores. Rollback is safe without a down-migration, which is the repo's
  existing posture (`docs/adr/0001`).
- **A client shipped before this change** → The API addition is optional, so an old client keeps working
  against a new daemon, and a new client degrades to sending no reference against an old daemon.

## Migration Plan

One forward-only migration (`0006`) adding a nullable column; it runs on daemon start like every other. No
backfill: existing messages keep a null reference, which reads as "no reply", which is what they carried.
Rollback is reverting the release; the extra column is inert to an older build.

VS-14's `project_id` is already on `main`, so there is no coordination to do at merge time beyond a normal
rebase: this change adds a second, independent column to the same table and a second, independent pair of
fields to the same payload, touching the same three lines of `insertMessage`, `inbound` and `messages`.

## Open Questions

None. The three judgement calls that could have become questions — deriving the excerpt at read time
instead of storing it, bounding it at 500 characters, and leaving the wake's `reason` string alone — are
settled above with their rationale, and none of them changes what the human asked for.
