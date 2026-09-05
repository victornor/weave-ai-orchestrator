## Why

VS-15 put a conductor question where it was asked: the card is an item of the message list, directly after the conductor message of the turn that raised it, and later messages push it up (`packages/ui/src/routes/Chat.tsx`, `packages/ui/src/lib/dispatch.ts`). That reads well as a record and badly as a prompt. The workspace owner reports that an open decision is lost as soon as the conversation moves on: the conductor keeps working, messages arrive, and the thing it is waiting on scrolls out of the viewport with no sign left that anything is pending. The only reliable way back to it is `Needs you` or scrolling the history.

The chat already has the two halves of the fix. It loads open **and** answered decisions in one query, and it already renders a block of open decisions with no anchor below the conversation — so a decision that cannot be placed in the history is the one that is always visible today, and one the conductor asked in the current thread is the one that disappears. Inverting that is the change.

## What Changes

- **Every open decision awaiting the human is pinned to the bottom of the chat**, in a region between the message list and the composer, whatever turn raised it. It is on screen without scrolling, it stays there while the conductor's next turn streams, and it is rebuilt in the same place after a reload.
- **Several open decisions stack, oldest first**, so the longest wait reads first and the order does not shuffle as answers come in. The region is capped at a share of the viewport and scrolls within itself; it never pushes the composer off screen.
- **An open decision is rendered once.** While it is open it is only in the pinned region, not also at its anchor in the history.
- **Once answered, the card leaves the pinned region and takes its place in the conversation**, directly after the conductor message of the turn that raised it, inert, showing what was chosen and when — the behavior VS-15 specified for an answered card, now reached from wherever the answer came from: the pinned card, or `Needs you`.
- **The message list is untouched.** The pinned region sits outside the scrolling body, so follow-the-bottom and the scroll-to-bottom button (VS-38) keep the list they belong to, and history paging (VS-39) is unaffected.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `human-decisions/option-cards`: where an open decision waits in the conductor chat — pinned to the bottom rather than anchored where it was asked — and where the answered record then lives.

## Impact

- `packages/ui/src/routes/Chat.tsx` — open decisions are collected from the decision query, sorted oldest first and rendered in a pinned region above the composer; the message list renders only decisions that are no longer open; the block of unanchored open decisions inside the scrolling body is gone.
- `packages/ui/src/lib/dispatch.ts` — unchanged behavior; the comments describing where an anchored decision lands are corrected.
- `packages/ui/src/test/chat.test.tsx` — the placement tests VS-15 wrote are rewritten for the pinned region, and cover stacking, answering from it, and the answered record staying in history.
- No change to the decision model, to `decisions.answer`, to `Needs you`, to the HTTP surface or to the daemon.

## Out of scope

- Worker questions on ticket pages, and the `Needs you` view. A worker question that already surfaces in the chat is pinned with the rest rather than left below the conversation, but nothing is added to or removed from the ticket page.
- The terminal chat (`packages/tui/`) and the Telegram channel, which render decisions their own way.
- Decisions that expired, were withdrawn or were superseded; they are neither pinned nor loaded, exactly as today.
