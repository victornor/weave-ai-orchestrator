## Why

Captain asked for a way to see, without adding clutter, when a conductor message answers a specific
human message rather than being unrelated chat noise (a ticket landing, a plan being ready). The chat
already renders a compact reply quote for the human's own replies (`message-reply-reference`); the
conductor side of the same mechanism is unbuilt — `ac_human_send`, the only way the conductor's words
reach the human, has no way to say which message it is answering, so `threads.outbound()` never gets a
reply target and every conductor message renders identically today.

## What Changes

- `ac_human_send` gains an optional `replyToMessageId` input. When set, the outbound message is stored
  with that reply reference — validated and excerpted through the same path `threads.inbound()` already
  uses for a human's reply, not a second implementation.
- `ThreadsService.outbound()`'s type and implementation grow to accept and validate `replyToMessageId`,
  deriving `replyToExcerpt` and rejecting (not silently dropping) a target that does not exist or belongs
  to another thread — today the interface does not expose the field at all, even though `insertMessage`
  already had room for it.
- **Default target**: when `ac_human_send` is called without `replyToMessageId` (the field is omitted
  entirely) and the run was woken by exactly one `human_message` wake, the reply target defaults to that
  message. Passing `replyToMessageId: null` explicitly sends with no target regardless of the wake; this
  is how the conductor sends an unrelated message (a ticket landing) in the same turn as answering one.
  When the turn was woken by zero or more than one human message, there is no default — an unset field
  behaves as `null`.
- No rendering change: the chat already shows the compact quote for any message carrying
  `replyToExcerpt`, in either direction — captain's "without bloating the chat" is already satisfied by
  the existing renderer.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `conductor-chat/message-reply-reference`: the conductor's outbound messages can now carry a reply
  reference (previously always `null`); `ac_human_send` accepts a reply target with a default derived
  from the turn's wake, an explicit opt-out, and the same validation the human's side already has.

## Impact

- `packages/server/src/tools.ts` — `ac_human_send` input schema and handler; a small helper resolving
  the default target from this turn's bundled wakes (alongside the existing `originThreadId`).
- `packages/core/src/api.ts` — `ThreadsService.outbound()` signature.
- `packages/core/src/threads/service.ts` — `outbound()` validates and derives the excerpt.
- Tests: `packages/core/src/threads/threads.test.ts` (outbound validation/excerpt), a new
  `packages/server/test/integration.test.ts` case (default-target resolution and opt-out through the
  real wake → tool → thread path).
- No web app change: `packages/ui/src/routes/Chat.tsx`'s `ChatMessage` renderer already renders
  `replyToExcerpt` for both directions.
