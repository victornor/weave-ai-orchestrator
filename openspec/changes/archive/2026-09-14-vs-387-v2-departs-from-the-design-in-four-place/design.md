## Context

See `proposal.md` — Why. The four departures live in three V2 components, all under
`packages/ui/src/v2/`. V1 already solved the same problems in its own components and is not part of
this change:

- `work/Work.tsx` folds the board through `work/board.ts`. The column width is already inline
  (`flex: '0 0 108px'` when empty, `'1 0 236px'` when not); the card's tag row renders
  `folded ? statusText(ticket.status) : null` where `folded` compares the folded column **key**
  (`'todo'`) against the raw status (`'backlog'`), so a Backlog card is labelled "Backlog".
- `map/MapCanvas.tsx` draws every node as `<circle r={CORE_RADIUS[kind] ?? 5} fill={hue} />`;
  `nodeHue` already colours a worker by status and a project/workspace by hue.
- `ChatPage.tsx` builds `rows` from `chatEntries`/`chatRows`. The channel manager pushes a
  human-owned decision to the thread as a message whose `parts` carry a decision card and whose
  `body` is the decision's title and context (`decisionCard` in `packages/server/src/channels.ts`).
  V2 renders `message.body` through `ChatMessage` and never inspects the card parts, so the pushed
  decision reads as an ordinary message. V1's chat instead renders the card in place of the body
  (`replaceBody={cardParts.length > 0}` in `routes/Chat.tsx`), which is why V1 does not show the
  prose fallback and V2 does.

## Goals / Non-Goals

**Goals:**

- The three unmet design requirements corrected: no self-tagging status on a Work card, a shape per
  Map node kind, and no decision records rendered as prose in the Chat conversation.
- The empty-column width pinned by a test that asserts the width and the widen-on-arrival
  behaviour, since the code already renders it (see Decisions).
- A decision renders where it is answerable: the full card inline on phone, the pane on desktop, and
  one note line once answered (captain's correction, 2026-09-14).
- V1 at `/` and every shared view model unchanged.

**Non-Goals:**

- Rendering a decision in the desktop conversation, where the pane already carries it; the inline
  card is phone-only by construction.
- Any change to the channel push, the thread schema or `chatEntries`/`chatRows`.
- The Map legend's content (it already derives from the statuses present) or a Workspace node's
  colour. Only the shape changes.
- The card's optional design `state` tag (APPROVED/MERGED/HELD/QUEUED); the ticket's acceptance is
  that no tag duplicates the column.

## Decisions

**Item 1 — no production change; the finding was a misread.** Re-reading the pass's own capture
(`desktop-dark/03-work.png`) shows the empty "In progress 0" and "In review 0" columns are ~108px,
narrower than the populated columns beside them; the code has narrowed empty columns since VS-346.
The acceptance asks for a test that asserts it, and the current test only checks `data-empty`, so
the work is a test that reads the rendered style (`flex`/`min-width`) on an empty column, plus a
test that the same column widens once a ticket lands in it. Alternative rejected: "fixing" the
width code, which would touch working behaviour for no gain. The rendered check still confirms it in
a real browser; if it disagrees, a fix task is added then.

**Item 2 — drop the folded-status tag, keep kind and tier.** The `folded` branch exists to flag a
ticket whose column differs from its raw status, but it misfires on `backlog→Backlog` because it
compares the column key rather than the column's owner. The design carries exactly kind and tier
(and an optional merge state we are not adding), and `web-v2/work` already says "kind and tier
tags", so deleting the branch aligns code with spec. The tier tag stays including its `default`
fallback: the design shows a tier on every card, and `default` is the setting a ticket with no
option resolves to (`workerModelTagLabel`), which VS-354 itself would not call a bug. Alternative
rejected: relabelling the status tag, which would still duplicate the column.

**Item 3 — an SVG shape per kind in `MapCanvas`.** Keep `data-kind` on the `<g>` and swap the single
`<circle>` for `<circle>`/`<rect>`/`<polygon>` by `node.kind`, sized from the existing
`CORE_RADIUS`. The unit test asserts the child element per kind (jsdom cannot measure geometry, so
the shape element is the Observable fact, per the testing convention). Colour, label, tooltip and
`onOpen` are untouched. Alternative rejected: a glyph-path table, which makes the shape harder to
assert and to read.

**Item 4 — a decision push renders per width, and an answered one leaves one note.** Captain's
correction of 2026-09-14 replaces the earlier "nothing in the conversation" rule: on phone the card
is more useful inline, where it can be answered without leaving chat; on desktop the pane already
carries it beside the conversation. A message is a decision push when
`decisionCardPartsOf(message.parts).length > 0`, and it is kept in the conversation only while a
decision it names is known; the prose fallback is never rendered as a message. Where it sat:

- **open + pane absent** (phone, and any region below the 620px split) → the full answerable
  `V2DecisionCard`, the same component the pane uses, so answering works inline. Answering marks the
  decision answered in a small local map (`justAnswered`) so the card becomes its note in place,
  the optimistic swap the pane and Needs you already get (VS-369); the map entry is cleared when a
  non-closed refusal comes back.
- **open + pane present** (desktop) → nothing; the pane carries it.
- **answered, any width** → one muted note line, `You decided:` for an approval kind (`approval` or
  `*_approval`), `You answered:` otherwise, then `<answer> — <title>`, the answer being the chosen
  option's label else the first line of the text, linked to the decision's ticket or Needs you.

The card-or-nothing switch reuses the pane's own signal — `shouldSplit(shellWidth)` — guarded by
`shellWidth > 0`: `useElementWidth` reads 0 on the first render, and treating that as "phone" would
flash the card on desktop before the pane replaced it. Waiting costs a phone one unmeasured frame
with no card and never shows desktop a card it must drop. The answered state comes from a second
read of the existing decisions route (`status: 'answered'`), kept separate from the pane's open list
so an answered card still clears from the pane optimistically — no daemon or API change. All in
`ChatPage` (the V2 layer), not the shared `chatEntries`, so V1 is untouched.

## Risks / Trade-offs

- **An answered decision's trace is a note, not a card** (captain's correction, 2026-09-14). On
  phone the open card is inline and answerable; once answered it collapses to one muted line at
  every width. The answered state comes from a second read of the existing decisions route
  (`status: 'answered'`), kept separate from the pane's open list so a card still clears from the
  pane optimistically (VS-369). No daemon or API change.
- **Multiple card parts on one message** would render one card/note per part. The channel push
  carries exactly one card per message, so this is a non-case today; the render loops over the parts
  so it degrades to one element per decision rather than dropping any.
- **Item 1's fix is a test, not code.** If the rendered check finds empty columns wide in a real
  browser (the pass's capture suggests otherwise), the plan already carries the fallback: fix the
  width in `KanbanColumn` and keep the test. [Risk] the false-positive call is wrong → [Mitigation]
  the rendered check is an explicit task, not an assumption.
- **jsdom cannot measure layout.** The width and shape tests assert the rendered style and the
  shape element, not geometry; the real-browser capture is where the pixels are judged.
- **Suppressing a message class could hide a real decision a human was meant to see.** The pane on
  desktop and the Needs-you count in Chat's status bar keep it visible; the phone's Needs you tab is
  the documented surface. [Mitigation] the rendered phone capture is compared against
  `phone-dark/01-chat.png`.

## Migration Plan

Not applicable — a frontend-only change served from the built UI. No data, route or daemon change;
rollback is the previous UI build.

## Open Questions

None.
