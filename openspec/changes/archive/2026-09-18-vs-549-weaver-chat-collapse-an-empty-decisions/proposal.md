# Collapse an empty decisions pane, and show the chosen roadmap block on sent messages

Tracker change for [VS-549](weave://tickets/VS-549). A `change` ticket in project `agent-conductor`.
Two related UI polish items from captain's UI polish #2 block (2026-09-18). A sibling ticket moves the
Plan modal into tabs on the same screen; this change stays inside the decisions pane and the message
metadata row so the two rebase cleanly.

## Why

**An empty pane costs width for nothing.** The V2 weaver chat splits the conversation and the open
decisions into a draggable right pane (300–560px). `ChatPage` currently renders that pane whenever the
chat region is wide enough to split, so a workspace with nothing waiting still loses its column: the
`web-v2/chat` spec even requires the empty pane to stay ("The decisions pane is present whenever the
layout is split"), and the code reads `rail = canSplit`.

**A chosen block disappears after sending.** VS-491 lets the composer tag a message with one of the
project's open roadmap blocks and stores it on the message (`ThreadMessage.blockId`), but the sent
message only shows the project. After sending there is no way to tell that a block was chosen or which
one, so the recorded intent is invisible in the conversation.

## What Changes

- **The decisions pane collapses when nothing is waiting.** On desktop, when no decision is open the
  pane renders collapsed to a narrow right rail instead of holding its full width; the conversation
  takes the reclaimed width. A visible, keyboard-operable control on the rail expands the pane again,
  so a collapsed pane is never unreachable.
- **The collapse follows the live decision count.** The expanded state is derived from the open
  decisions, not snapshotted at mount: a decision arriving while the chat is open expands the pane
  without a reload, and answering the last one collapses it again. A pane the reader expanded by hand
  while nothing was waiting stays until they collapse it or a decision arrives and is answered.
- **The width change is animated**, through the existing V2 duration token, and is instant under the
  reader's reduced-motion preference.
- **A sent message shows the roadmap block it carried**, beside the project tag it already shows, in
  the same `.v2-tag` idiom and naming the block by its title, not its id. A message sent with a
  project and no block renders exactly as it does today. It wraps rather than displacing the body, so
  it reads at phone width too.
- **Rendered evidence.** Both items get rendered captures in both themes, at desktop and phone width,
  attached to the ticket.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/chat`: the empty-pane requirement is replaced. Where the pane was required to stay present
  whenever the layout is split, it now collapses when nothing is waiting, follows the live open-decision
  count, animates the change, and stays reachable through a deliberate expand control.
- `conductor-chat/message-project-context`: a human message sent with a roadmap block now shows that
  block on the sent message, beside the project marker, in the same idiom.

## Impact

- `packages/ui/src/v2/ChatPage.tsx` — the expanded/collapsed decision state, the collapsed rail, and
  the expand/collapse controls.
- `packages/ui/src/v2/chatSplit.ts` — the collapsed rail's width constant.
- `packages/ui/src/v2/ChatConversation.tsx`, `ChatMessage.tsx` — a `blockName` prop from the chat to
  the message metadata row, rendered beside the project tag.
- `packages/ui/src/api/hooks.ts` — a small multi-project query resolving the block titles a message
  references (the chat already loads one project's blocks for the composer).
- `packages/ui/src/index.css` — only if a shared transition utility is needed; the durations and the
  reduced-motion rule already exist.
- Tests: `packages/ui/src/test/v2chat.test.tsx` (split/collapse and the block tag), plus the
  composer/chat harness alongside them.
- No server, API, DB, CLI or Settings change; `blockId` is already stored and returned.
