## Why

2026-09-11, captain sent an 11,064-character analysis. `ac_inbox` delivered 2,000 characters of it —
18% — ending mid-word, with no ellipsis, no `truncated` flag, and no pointer to the rest
(`packages/core/src/threads/service.ts:203`, `body: body.slice(0, 2000)`). The cut is visible only
if it happens to land mid-syllable; landing on a sentence boundary, which it will roughly one time
in twenty, leaves the conductor confidently reviewing a document it saw a fifth of. There is also no
tool that reads a thread message, so once truncated the rest was unreachable through any supported
path — recovering it meant reading the workspace SQLite file directly.

Bounding the payload is right: an unbounded body in a coalesced wake bundle (several queued human
messages folded into one wake's `payload.bundle`) is the failure mode on the other side, and the
payload is stored, not just rendered. The defect is that today's bound is silent and terminal.

## What Changes

- **The wake payload says when it was cut.** When a human message's body exceeds the bound, the
  `human_message` wake payload carries `truncated: true` and `bodyLength: <original character
  count>` alongside the truncated `body`. A message within the bound is byte-for-byte unchanged —
  no `truncated` field, no `bodyLength` field — so nothing about it reads as truncation.
- **The full body gets a supported read path.** `ThreadsService` gains `message(threadId,
  messageId)`, returning the full stored `ThreadMessage` row (already sitting in
  `thread_messages`), scoped to the thread the same way `attachment()` is — a message from another
  thread reads as `not_found`, not a cross-thread leak. It is exposed as a new conductor-scoped MCP
  tool, `ac_thread_message_get`.
- **The bound moves from 2,000 to 8,000 characters.** 2,000 is small for how captain actually
  writes — a pasted report, a stack trace, a spec section. 8,000 covers most of what currently gets
  cut without letting a coalesced bundle of several queued messages balloon: the marker plus the
  fetch path is what makes any bound safe, so the number only has to be a reasonable default, not a
  guarantee.
- **No other wake payload changes.** `ticket_comment` wakes (`packages/core/src/tickets/service.ts`
  — both `comment()` and `followUpWithoutWorker()`) slice a comment body at 500 characters the same
  silent way. They are out of this change's scope — the full comment is already reachable through
  the existing `ac_ticket_comments` tool, which a truncated thread message had no equivalent of —
  but the report documents the finding per the ticket's acceptance criteria.

## Capabilities

### New Capabilities

- `agent-tools/thread-message-truncation`: the `human_message` wake payload states when its body
  was cut and how long the original was; an unaffected message carries no new fields; a
  conductor-scoped tool reads a thread message's full stored body by id, scoped to its thread.

## Impact

- `packages/core/src/threads/service.ts` — the truncation bound and marker on the `human_message`
  wake payload; new `message(threadId, messageId)` on `ThreadsService`.
- `packages/core/src/api.ts` — `ThreadsService.message` added to the interface.
- `packages/server/src/tools.ts` — new `ac_thread_message_get` tool.
- Tests: `packages/core/src/threads/threads.test.ts` (marker present/absent, the 11,064-character
  reproduction, `message()` scoping and not-found); `packages/server/test/mcp.test.ts` or
  `integration.test.ts` (the new tool, conductor-only scope).
- No schema/migration change — `thread_messages.body` already stores the full text unbounded.
