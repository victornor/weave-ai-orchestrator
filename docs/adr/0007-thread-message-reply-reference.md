# ADR 0007 — A human message names the message it answers, with the quote resolved at read time

Date: 2026-09-05 · Status: accepted

## Context
PLAN §6 enumerates the `thread_messages` columns and PLAN §14.2 fixes the inbound path as `thread_messages` row → `enqueueWakeup(agent, {source: human_message, payload: {threadId, messageId}})`. Neither leaves a place for the message a reply answers, so when the conductor had asked something and other messages had landed since, "yes, do it" had to be matched to its question by ordering. That misread on 2026-09-05.

ADR 0005 added the first optional reference on this table (`project_id`). This is the second, and it deliberately reuses that mechanism rather than inventing another.

## Decision
`thread_messages` gains a nullable `reply_to_message_id TEXT REFERENCES thread_messages(id)` (migration `0006`), and the `human_message` wake payload gains `replyToMessageId` and `replyToExcerpt`. `POST /threads/:id/messages` accepts an optional `replyToMessageId`, resolved before the write by a lookup scoped to the message's own thread (`WHERE id = ? AND thread_id = ?`), so a reference that names no message of that thread stores nothing and wakes nobody.

**The quoted text is derived at read time, not stored.** `ThreadsService.messages` left-joins the referenced row and returns its body as a bounded `replyToExcerpt` (500 characters, one constant shared with the wake payload).

## Consequences
- The reference is a scalar relationship in a column, so it is queryable and legible, rather than a private key inside `parts_json` (which holds the CanonicalMessage content, not routing metadata).
- Scoping the resolution to the thread makes a cross-thread — and therefore cross-workspace — reference impossible rather than merely checked: the query cannot return a row from another thread.
- Deriving the excerpt keeps one source of truth for the text and, more concretely, makes the quote renderable on a paged read: `messages()` is paged at 50, so a reply to an older question would otherwise render with no quote after a reload. The alternative, a second stored column, needs no join but duplicates text one row away and can go stale.
- The excerpt is a locator, not a transcript. The conductor also receives the referenced message's id and holds the full text in its own session, so bounding it costs nothing and keeps a page of replies from growing without bound.
- No `ON DELETE` clause is needed because thread messages are never deleted anywhere in the tree, so the self-reference cannot dangle — the same posture as `project_id`.
- The wake's `reason` string is deliberately unchanged: ADR 0005 put a project slug there because it is a short stable token, and a truncated sentence would be noise in the wake list and the run log.
- Optional at every layer: Telegram, the CLI channel and the TUI chat send no reference and are unchanged, as is every message that predates the migration. The service permits a reference between any two messages of a thread; only the web conductor chat offers the control, and only on conductor messages.
