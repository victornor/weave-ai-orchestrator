## Why

VS-43 pins every open human-owned decision in a region above the composer in the conductor chat and
keeps it there until it is answered. That is right for a decision the human is about to take and
wrong for one they are not: the region is bounded to 45svh, so two plan approvals they mean to read
tonight take half the chat away from the conversation they are having now, and the only way out is
to answer.

The workspace owner's words: "We should have the option of dismissing a decision card anchored to
the conductor chat, leaving it just in the Needs you page. Some decisions might need to be taken
later and having the card fill space on the chat is annoying."

`Needs you` already lists exactly the same decisions, so there is somewhere for a deferred decision
to wait. What is missing is a way to say "not now" that is not an answer.

## What Changes

- **A pinned card can be hidden.** Each card in the pinned region gains a full-width 44 px
  **Hide from chat** band under its action band. Pressing it takes that card out of the region. The
  decision is untouched: still open, still owned by the human, still in `Needs you`, and the daemon
  is never told — nothing is sent, and no answer is recorded.
- **Hiding is per device.** The hidden set lives in `localStorage` under
  `conductor.decisions.hidden.<ws>`, one entry per decision id, so it survives a reload and a walk
  around the app, and a phone that cleared its chat does not clear the laptop's. A per-account
  preference through the daemon would need a new decision field and a new route; this is a view
  preference, sits beside `wsExpansion` and `chatScroll`, and can be replaced later without changing
  what either surface promises.
- **A hidden decision comes back on its own when the ask changes.** The entry stores a fingerprint
  of the decision as it read when it was hidden — title, context, recommendation, options, whether
  free text is allowed, expiry — so an **edited** decision no longer matches its own entry and pins
  again. A **follow-up comment** on the ticket it hangs off (the `ticket.comment` workspace event)
  restores it. A decision **within an hour of expiring** is shown whatever was stored.
  **Supersession** needs no trigger: a superseded decision is not open, and its replacement is a
  different id that was never hidden.
- **The region says what it is not showing.** With at least one open decision hidden it renders
  "N hidden from chat — show them again", which restores every one of them at once. The chat header
  still counts hidden decisions among those that need the human, because they still do.
- **`Needs you` marks them and offers each back.** A decision hidden from the chat is listed exactly
  as before, with "Hidden from chat" and a **Show in chat again** action above its card. Answering
  it is unchanged in every respect.

## Capabilities

### New Capabilities

(None. Where an open decision waits is already specified; what changes is that the human can take
one out of the chat without answering it.)

### Modified Capabilities

- `human-decisions/option-cards`: the requirement "An open decision waits pinned to the bottom of
  the conductor chat" gains an exception — a decision the human has hidden on this device is not in
  the region — and the capability gains a requirement, "An open decision can be hidden from the chat
  without answering it", carrying what hiding does and does not do, the count and restore in the
  region, the marker and per-decision restore in `Needs you`, and the three triggers that bring a
  hidden card back. Everything else about the region — that it is outside the message list, bounded,
  stacked oldest first, and answerable in place — is unchanged.

## Impact

- `packages/ui/src/lib/hiddenDecisions.ts` (new) — the store, the fingerprint, the expiry window and
  the `useHiddenDecisions` hook.
- `packages/ui/src/components/DecisionCard.tsx` — the optional `onHide` band, offered only on a card
  that is still a prompt.
- `packages/ui/src/routes/Chat.tsx` — the pinned region splits into shown and hidden, the "N hidden"
  restore, and a `ticket.comment` subscription that brings a hidden card back.
- `packages/ui/src/routes/NeedsYou.tsx` — the "Hidden from chat" marker and its restore action.
- `packages/ui/src/test/hiddenDecisions.test.tsx` (new), `chat.test.tsx`, `needsyou.test.tsx`.

## Out of scope

- Snoozing with a timer: hiding is indefinite until it is restored or re-triggered.
- Which decisions are pinned in the first place. In particular a merge approval on a YOLO ticket is
  still pinned and still offers an approve action — the daemon leaves that decision open until the
  auto-merge sweep lands the work — which is worth its own ticket but is not this one.
- Carrying the hidden set across devices.
