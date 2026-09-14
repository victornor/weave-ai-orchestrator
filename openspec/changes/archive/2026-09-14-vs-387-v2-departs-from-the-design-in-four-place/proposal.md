## Why

The VS-354 verification pass compared every built V2 screen against captain's mockups and found four
places where V2 departs from the design: empty Work columns, Work card tags, Map node shapes, and
decision records in the phone Chat conversation. Three of the four are explicit HANDOFF requirements
that are currently unmet, so V2 does not yet match the design a reviewer compares it against.

## What Changes

- **Work cards stop tagging their own status.** A kanban card carries the raw ticket status as a tag
  (for example "Backlog" on a Backlog card), redundant with the column it sits in. The card SHALL
  carry its kind and tier tags only (both are in the design and already in `web-v2/work`), and no tag
  that restates the column's status. The tier tag stays: the design shows one, and its `default`
  fallback is the setting a ticket with no option resolves to.
- **Empty Work columns are pinned narrow by a test.** The code already renders an empty column at
  ~108px (VS-346), and re-reading the VS-354 capture (`desktop-dark/03-work.png`) shows the empty
  "In progress 0" and "In review 0" columns are in fact narrow — the pass misread the image. What is
  missing is a test that asserts the width and the widen-on-arrival behaviour the acceptance asks
  for; the existing test checks only the `data-empty` marker. Behaviour is otherwise unchanged.
- **Map nodes carry a shape per kind.** Today every node is a circle. A workspace SHALL be a circle,
  a project a square and a worker a triangle, keeping the existing colour rule (a worker by status, a
  project and workspace by hue).
- **A decision renders where it can be answered, and leaves a note once answered.** The channel
  manager pushes every human-owned decision to the thread as a card message, and V2 renders that
  message's prose fallback (the decision's title and context) as an ordinary conversation message —
  which duplicates the desktop decisions pane and fills the phone Chat scroll area with unanswerable
  records. Captain's correction (2026-09-14) fixes the rule per width: on **phone**, where the pane
  is absent, an open decision renders as the full **answerable card inline** so it can be accepted
  from chat; on **desktop**, where the pane is beside the conversation, an open decision renders
  **nothing** in the conversation. Once **answered**, every width leaves exactly one muted note line
  where the card sat — `You decided: …` for an approval, `You answered: …` for a question — linked
  to the decision's ticket or to Needs you. Needs you is unchanged. The answered state and label
  come from a second read of the existing decisions route; no daemon or API change.
- **Tests** pin all of it: a narrow empty column that widens when a card arrives, no status tag equal
  to a card's column, a shape per Map node kind, an open decision as an answerable inline card on
  phone and nothing in the desktop conversation, an answered decision's one note line at both
  widths, and real messages untouched.

Frontend only. No daemon, API, MCP, CLI or migration change and **V1 at `/` is untouched**.

## Capabilities

### New Capabilities

_None. This ticket corrects four existing V2 screens against the design; it introduces no new
screen or capability._

### Modified Capabilities

- `web-v2/work`: the card-anatomy requirement is tightened — a card's tags are its kind and tier, and
  no card tag restates its column's status; the empty-column requirement gains a test-level width and
  widen-on-arrival scenario (behaviour already specified).
- `web-v2/map`: a new requirement — each node renders the shape its kind owns (workspace circle,
  project square, worker triangle) while keeping the existing colour rule.
- `web-v2/chat`: a new requirement — a pushed decision-card message never renders as prose; an
  **open** decision renders as an answerable card inline where the decisions pane is absent (phone)
  and nothing where it is present (desktop); an **answered** decision leaves one muted note line at
  both widths.

## Impact

- **Modified:** `packages/ui/src/v2/work/Work.tsx` (drop the folded-status card tag; no change to the
  column width code), `packages/ui/src/v2/map/MapCanvas.tsx` (shape per node kind),
  `packages/ui/src/v2/ChatPage.tsx` (render a decision per width and a note once answered).
- **Reused, not forked:** `decisionCardPartsOf` (`@weave-ai/render`) to recognise a decision-card
  push, the existing `chatEntries`/`chatRows` view model and `V2DecisionCard` (the same card the pane
  and Needs you render, now inline on phone too).
- **Tests:** `packages/ui/src/test/v2work.test.tsx` (column width and no status tag),
  `packages/ui/src/test/v2map.test.tsx` (shape per kind), `packages/ui/src/test/v2chat.test.tsx`
  (open inline card on phone, nothing in the desktop conversation, one note once answered at both
  widths, real messages untouched).
- No HTTP route, MCP tool, CLI command, database migration or daemon file changes. V1's board, chat
  and tests are unchanged.
