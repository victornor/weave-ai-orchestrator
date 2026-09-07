## 1. The hidden set

- [x] 1.1 `packages/ui/src/lib/hiddenDecisions.ts`: `localStorage` under `conductor.decisions.hidden.<ws>`, guarded the way `wsExpansion` guards its own, pruned after a month; `decisionFingerprint`, `isHiddenFromChat` (fingerprint match plus the expiry window), and a `useHiddenDecisions` hook whose store is shared across the routes of one tab.
- [x] 1.2 `packages/ui/src/test/hiddenDecisions.test.tsx`: hides only the decision it was taken against, shows an edited one again, shows one about to expire, keeps workspaces apart, survives a malformed store, and prunes old entries.

## 2. The control on the card

- [x] 2.1 `DecisionCard` takes an optional `onHide` and renders a full-width 44 px "Hide from chat — stays in Needs you" band below the action band; a card that is inert offers none.

## 3. The chat

- [x] 3.1 `Chat.tsx` splits the pinned decisions into shown and hidden, passes `onHide`, and feeds both counts to the follow-the-bottom hook so the region's height change is still accounted for.
- [x] 3.2 The "N hidden from chat — show them again" affordance, restoring every hidden open decision at once.
- [x] 3.3 A `ticket.comment` subscription that restores every hidden decision hanging off that ticket.

## 4. Needs you

- [x] 4.1 A "Hidden from chat" marker and a "Show in chat again" action above the card of any decision hidden from the chat; answering is untouched.

## 5. Cover it

- [x] 5.1 `chat.test.tsx`: hiding answers nothing and still counts, the "N hidden" restore, persistence across a reload, re-pin on a comment on its ticket, re-pin on an edit, and no hide control on an answered record.
- [x] 5.2 `needsyou.test.tsx`: a hidden decision is still listed and marked, the restore action clears the marker without touching the decision, answering a hidden decision is unchanged, and an edited decision is no longer marked.
- [x] 5.3 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
