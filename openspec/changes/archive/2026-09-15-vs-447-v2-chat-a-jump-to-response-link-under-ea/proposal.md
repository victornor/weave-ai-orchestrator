# V2 chat: jump from a human message to the weaver's response

Tracker change for [VS-447](weave://tickets/VS-447). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: scrolling back through the conversation, there is no way to get from one of
their own messages to what the weaver answered. The reply data is half-there — some weaver messages
carry `reply_to_message_id` and `ChatMessage` already renders the quoted excerpt — but nothing jumps,
and only 246 of 2,132 weaver messages over a recent week carry the link at all. Over the same window
169 of 412 human messages had no linked reply, so the stored link alone misses about 40%.

## What changes

- **Resolve the response for every human message client-side, from the loaded conversation.**
  A new pure helper (`packages/ui/src/lib/replyTargets.ts`) returns, for each inbound message, the
  outbound messages that answer it:
  1. the same-thread outbound messages whose `reply_to_message_id` is it;
  2. otherwise the first outbound message after it and before the human's next inbound message.

  A link that names a non-inbound message or a message outside the thread is ignored. The helper is
  pure and independently tested, because the fallback is a rule, not a render detail.
- **The link.** `ChatMessage` (the shared message component) shows a small, quiet **"Jump to
  response"** under an inbound message that has one, live as a reply arrives. With two or more linked
  responses the link jumps to the first and highlights all of them.
- **The anchor.** Every rendered message row carries `data-message-id` and is programmatically
  focusable, so a jump has a stable target.
- **Jump and highlight.** Pressing the link scrolls the conversation scroller to centre the target
  (instant under `prefers-reduced-motion: reduce`), pauses stick-to-bottom following so the follow
  cannot yank the view straight back, briefly highlights the target — a soft accent wash that fades
  on the V2 motion tokens, over a static ring that stays visible under reduced motion — and moves
  keyboard focus to it.
- **Jump back.** The quoted excerpt above a weaver reply becomes a jump back to the human message it
  answers, with the same scroll and highlight; it stays a static quote when its target is not loaded.
- **Stick-to-bottom gains a `pause()`.** The existing hook can stop following without moving the list,
  so a deliberate jump away from the bottom also surfaces the "scroll to bottom" button.
- **Shared component.** The link, the jump-back quote and the anchor live in `ChatMessage`, and the
  scroll/highlight state in the V2 conversation list, so the Plan modal inherits both when VS-442
  moves its conversation onto the shared view.
- **Tests:** explicit-reply link, fallback link, hidden when there is no response, the jump scrolling
  to and highlighting the right message, the two-reply case highlighting both, cross-thread and
  outbound-target links ignored, the quote jump-back, reduced motion, and the link appearing when a
  reply arrives live.

## Out of scope

- How the weaver sets its reply target (`weave_human_send`'s default is VS-449) and the composer.
- The Plan modal's own conversation list, which VS-442 will replace with the shared view; this change
  only makes `ChatMessage` carry the behaviour so that replacement inherits it.
- The `JumpView` search-result window, which is a separate context list, not the conversation.

## Overlaps

- VS-440 (**merging**, touches `ChatPage`'s live section) — rebase onto it if it lands first and keep
  its live-trace behaviour.
- VS-442 (**not started**, will move the Plan modal onto the shared conversation view) — rebase if it
  lands first.