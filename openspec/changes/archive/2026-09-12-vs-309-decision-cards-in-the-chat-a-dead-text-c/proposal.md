## Why

A decision pushed to the conductor thread already carries its whole card — title, context, every
option with its key and label, which one is recommended, and a `ref` naming the decision
(`decisionCard`, `packages/server/src/channels.ts`). The web chat reads none of it: it renders only
the message's plain-text fallback, so captain gets the question as prose with no options to press.
Separately, an answered decision is attributed to the run that raised it; when that run left no
thread message — which is most of them, since a worker's run posts none — it is collected into
`unanchoredDecisions`, an array nothing renders, so the record of what was decided disappears from
the conversation.

## What Changes

- **The chat renders a message's `card` parts as real decision cards.** A message whose `parts`
  carry a card renders that card in place of the text fallback, so the options captain was already
  sent are pressable where he was asked them, with the recommendation marked. A card part with no
  matching loaded decision degrades to its text rather than vanishing.
- **A decision is anchored to the message that carried its card.** `chatEntries`
  (`packages/ui/src/lib/dispatch.ts`) attributes a decision to the message whose card part names it
  (by `ref.id`) before falling back to the raising run's message. The dead `unanchoredDecisions`
  array is removed; the card's own `ref` is what replaces it.
- **An open decision is answerable inline, and never shown as two cards at once.** An open decision
  with a card message renders inline; the pinned region (`bottom` strip or `split` rail) suppresses
  any card currently on screen, so the only card reading at a time is the inline one, and a card
  scrolled out of view is pinned for reach. Open decisions with no card message (nothing pushed to
  the thread) remain pinned exactly as today.
- **Answering from the inline card uses the one existing answer path** — the same `answerDecision`
  the pinned card and `Needs you` use, including the offline queue and the secret-carrying refusal.
  No second answer path is added.
- No server, database, schema, channel or Telegram change. Which decisions are pushed to the thread
  and the copy `decisionCard` builds are unchanged.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `human-decisions/option-cards`: a decision pushed to the conversation now renders as an
  answerable card where it was asked; an open decision is never rendered as two cards at once; an
  answered decision is anchored to the message that carried its card (falling back to the raising
  turn's message) so it survives when its raising run left no message.

## Impact

- `packages/render/` — a `decisionCardPartsOf` helper alongside `attachmentPartsOf`, to read a
  message's card parts and their `ref` from the untyped `parts` array.
- `packages/ui/src/lib/dispatch.ts` — anchor decisions by card `ref` first, then raising run; drop
  the `unanchoredDecisions` field.
- `packages/ui/src/routes/Chat.tsx` — render card parts inline through `DecisionCard`; suppress a
  pinned card while its inline card is on screen; wire the inline card to `answerDecision`.
- `packages/ui/src/components/DecisionCard.tsx` — unchanged, reused. `Chat.tsx` gains one shared
  `ChatDecisionCard` wrapper so pin and inline cannot drift.
- `packages/ui/src/lib/` — a small pure helper for "which open decisions remain pinned given what is
  on screen", plus an `IntersectionObserver`-backed hook rooted at the chat's scroll container.
- Tests: `packages/ui/src/lib/dispatch.test.ts`, `packages/ui/src/test/chat.test.tsx`,
  `packages/render/src/attachments.test.ts` (or a new parts test).
- Screenshots of the chat with one open option card and one answered card in the same view, for
  review (uncommitted files in the worktree, absolute paths reported).
