# Weaver replies link to the human messages they answer

Tracker change for [VS-449](weave://tickets/VS-449). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

`weave_human_send`'s `replyToMessageId` defaults to the waking human message **only when exactly one
message woke the turn** (`defaultReplyToMessageId` in `packages/server/src/tools.ts`). When several
human messages wake one turn — a batched turn, or a bundle that also carries digests or decisions —
nothing is recorded unless the weaver passes an id, and the weaver passes `null` for relays. In the
last seven days 169 of captain's 412 messages (41%) had no weaver reply whose `reply_to_message_id`
pointed at them; every one had been answered.

The reply quote and VS-447's jump-to-response link both read the stored target, so an unrecorded
target is an answer that cannot be linked back to its question.

## What changes

1. A real many-to-one link, `thread_message_replies(message_id, replied_to_message_id)`, written for
   every reply. `thread_messages.reply_to_message_id` stays as the single *quote* target (the newest
   message answered), so `replyToExcerpt` and every existing reader keep working. A migration
   backfills the table from the existing column, so history is complete through the same read.
2. `weave_human_send` omitted `replyToMessageId` → `ThreadsService.outbound` links the reply to every
   human message that woke the turn and that no earlier reply in the same run has linked (normally
   one; several when they were batched). Explicit `null` stays unlinked; an explicit id is linked
   exactly as given.
3. `ThreadMessage.replyToMessageIds` (oldest-first) is exposed on every read — `messages()`,
   `around()`, `message()` and the write return value — so the chat API and VS-447 can use the
   complete link set.
4. V2 chat renders the quote for multiple targets as the newest excerpt plus `+N more`.
5. Tool description updated to state the new default.

## Out of scope

The jump-to-response UI itself (VS-447). Rewriting historic messages beyond the link-table backfill —
the backfill is trivial and safe, and lives in the migration, not a separate commit.