## Why

In the web conductor chat the human can only append. When the conductor has asked something and other
messages have landed since, a short answer — "yes, do it" — does not say which question it answers, and
the conductor has to guess from ordering. That guess was wrong once already, on 2026-09-05. The chat
already carries structured context per message (the project reference from VS-14); which message is
being answered is the other half of the same gap, and it is the half that changes what gets built.

## What Changes

- A human message can carry an optional reference to another message **in the same thread**, stored as a
  column on `thread_messages`. A reference that names no message of that thread is rejected: nothing is
  stored and nobody is woken.
- Reading a thread's messages returns, alongside the reference, a bounded excerpt of the referenced
  message's body — derived from the referenced row at read time, so the quote is available even when the
  referenced message falls outside the page the client loaded.
- The `human_message` wake payload gains the referenced message's id and that same bounded excerpt, so
  the conductor maps the answer to its question without a lookup and without guessing. `ac_inbox` is not
  touched; it returns the payload verbatim.
- `POST /threads/:id/messages` accepts an optional `replyToMessageId`.
- The web conductor chat puts a reply control on every conductor message. Using it shows a compact,
  dismissable quote above the input; sending carries the reference, online and offline; the sent message
  renders the quote it carried.
- Not breaking: every field is optional at every layer. Telegram, the CLI channel, the TUI chat and every
  message that predates the migration are unchanged.

## Capabilities

### New Capabilities
- `conductor-chat/message-reply-reference`: how a human message references the conductor message it
  answers — choosing it in the chat, storing it with the message, showing it back on the sent message,
  and delivering it to the conductor as structured context.

### Modified Capabilities

(none — `conductor-chat/message-project-context` describes the project reference and keeps describing it
unchanged; this is a second, independent optional reference on the same row.)

## Impact

- **Schema**: `thread_messages` gains a nullable `reply_to_message_id` (migration `0006`). Additive,
  no backfill, no index; PLAN §6 enumerates this table's columns, so the deviation gets an ADR.
- **Core**: `ThreadsService.inbound` options and the `human_message` wake payload; `ThreadsService.messages`
  gains a self-join for the excerpt. `ThreadMessage` in `packages/shared/src/types.ts` gains two fields.
- **Server**: one optional field on `POST /threads/:id/messages`; `docs/API.md`.
- **Web**: `ChatRoute`, the message row and the composer's `scope` slot (shared with VS-14's project
  picker); `docs/design/DESIGN-CONTRACT.md`.
- **Unaffected**: `ac_inbox` and every other agent tool, the offline queue's storage format and flush,
  the conductor's prompt and skills, worker project isolation.
