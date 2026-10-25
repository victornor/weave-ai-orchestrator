## Why

On the operator's 5120 px-wide display the Global Chats screen stops growing at roughly 2560 px: pane
content stops expanding and the remainder of the window is empty. The screen is supposed to give the
conversation as much width as possible (HANDOFF §3), and the acceptance for this ticket is that at 5120
px the row fills the window with the panes split evenly.

## What Changes

- Chat's conversation column stops centring itself in a hard `max-width: 720px` box; it keeps a
  measure-bounded reading column for as long as the column is narrow (today's behaviour up to about
  1600 px of chat width), and above that it spreads the column to the region's width so a 2560 px pane
  (two panes on a 5120 px screen) is actually used.
- The measure rule SHALL have exactly one owner — a pure width resolver in `web-v2/chat`'s geometry
  module (`chatSplit.ts`, beside `shouldSplit`) — instead of the duplicated `max-w-[720px]` literals in
  `ChatPage` (composer) and `ChatConversation` (message column).
- **Diagnosis recorded, not guessed:** there is no `max-width` on any ancestor of the Chats row, no cap
  in `.v2-root`, `V2Shell`, `V2Page` or `index.css`'s `max-width: 100%`, and the pane `<section>`s
  genuinely stretch with `flexGrow`/`flexBasis: 0`. The apparent cap is the fixed 720 px reading column
  centred inside a pane that did fill the width, so at 2560 CSS px per pane the text occupies 720 px and
  the rest is margin. The fix is therefore in the conversation column, not in the pane row.
- Acceptance also covers the measurement question: the screenshots record `window.innerWidth` and
  `devicePixelRatio`, so if the operator's display scaling (5120 physical px at 2× = 2560 CSS px) were
  the whole story, the note says so and no layout is bent to compensate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/chat`: the conversation column's measure. A new requirement states that the message column
  and composer share one reading measure that widens with the region above a threshold and never
  imposes a fixed pixel cap on a wide region, and that the region's own width is what decides it.
- `web-v2/global-chats`: the pane row fills the viewport width at every desktop width, and panes divide
  that width in proportion to their weights (so two panes at 5120 px are each half the row, not half of
  a capped row).

## Impact

- `packages/ui/src/v2/ChatPage.tsx` (composer wrapper), `packages/ui/src/v2/ChatConversation.tsx`
  (message column), `packages/ui/src/v2/chatSplit.ts` (the new pure resolver) and its tests.
- No server, API, schema or data changes. Collapsed panes stay 40 px, drag weights unchanged.
- Docs: `docs/design/v2/HANDOFF.md` §3 gains the wide-screen rule so the next screen does not reintroduce
  a fixed cap.
