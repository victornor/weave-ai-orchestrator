## 1. Pin the open decisions

- [x] 1.1 Collect every open decision from the chat's decision query, oldest first, and render it in a region between the message list and the composer, outside the scrolling body, capped at a share of the viewport and scrolling within itself.
- [x] 1.2 Attribute a pinned card to the conductor when the conductor asked it, including during a turn that is still streaming and has no message to anchor to yet.
- [x] 1.3 Render an open decision only once: drop it from the message list, and drop the block of unanchored open decisions from inside the scrolling body.

## 2. Keep the history readable

- [x] 2.1 Render a decision in the message list at its anchor only once it is no longer open, so the answered record takes the place the open card used to hold.
- [x] 2.2 Keep the message list's follow-the-bottom and scroll-to-bottom behavior intact, accounting for the height the pinned region takes.

## 3. Cover it

- [x] 3.1 Route tests: an open decision pinned below the whole conversation and rendered once; the region between the list and the composer; several stacked oldest first; answering the right card from the region; the answered record leaving the region and staying in history.
- [x] 3.2 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
