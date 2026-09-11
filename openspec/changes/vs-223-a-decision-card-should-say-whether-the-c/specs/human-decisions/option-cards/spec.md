## ADDED Requirements

### Requirement: A plan, merge or action approval card shows whether the conductor has looked

Every surface that renders a `plan_approval`, `merge_approval`, or `action_approval` as a card — the conductor chat (pinned and in history), `Needs you`, the ticket page, the TUI, and `conductor decision show` — SHALL show that decision's conductor review state.

Each of the three states SHALL have its own visible rendering. No state SHALL be conveyed by omitting the review line: a blank would make **looked at** indistinguishable from **not looked at yet**, which is the distinction this requirement exists to make.

The copy SHALL be factual, not an endorsement, and SHALL be exactly this weight:

- **not looked at yet** — loud: the card shows the text `Conductor hasn't looked yet`
- **looked at** — understated but present: the card shows the text `Conductor looked` (or the after-the-fact variant). Quiet means dimmer type, not missing type. It SHALL NOT use a green seal, a checkmark of approval, or the words "signed off" / "approved by the conductor", and SHALL NOT be hidden, collapsed, or left as whitespace
- **looked at, with concerns** — loudest: the card shows `Conductor looked — has concerns` (or the after-the-fact variant)

When the state is **looked at, with concerns**, the card SHALL show the concern summary next to the action buttons, so a human tapping through a queue sees the objection at the moment of the decision rather than only in a chat message they may not have read. The concern is a short block of text, not a badge wrapping a sentence.

When `reviewedAt` is strictly later than `answeredAt`, the card SHALL say that the look arrived after the answer, distinct from a look that arrived before. An unanswered card never uses after-the-fact wording.

A card for any other decision kind SHALL NOT show a conductor review line.

Showing the review state SHALL NOT disable, delay, hide, or relabel any action the card already offers. The buttons stay the same keys, the same number, and the same immediate send.

A later review on an already-shown card SHALL become visible without a reload on any surface that already refreshes a live decision (the web app over the workspace event stream). A channel that pushed the card once as an outbound message SHALL NOT send a second answerable card with a duplicate set of approve buttons; if it surfaces a later **looked at, with concerns** at all, it does so as text, not as a new decision to answer.

#### Scenario: An unseen plan card says the conductor has not looked

- **WHEN** an open `plan_approval` whose review state is **not looked at yet** is shown as a card
- **THEN** the card says the conductor has not looked yet
- **AND** its Approve, Revise and Reject actions are enabled and send the same keys they send today

#### Scenario: A looked-at merge card is quiet

- **WHEN** an open `merge_approval` whose review state is **looked at** is shown as a card
- **THEN** the card shows the text that the conductor looked
- **AND** that text is present in the rendered card, not omitted or replaced with a blank
- **AND** it does not present that look as an approval, a sign-off, or a green endorsement
- **AND** its Approve merge and Request changes actions are unchanged

#### Scenario: A clean look is never a blank

- **WHEN** an open `plan_approval` whose review state is **looked at** is shown as a card
- **THEN** the review line is visible and reads that the conductor looked
- **AND** a reader can tell it apart from a card whose review state is **not looked at yet** without relying on the line being absent

#### Scenario: A concern sits next to the buttons

- **WHEN** an open `merge_approval` whose review state is **looked at, with concerns** is shown as a card
- **THEN** the card says the conductor looked and has concerns
- **AND** the concern summary is visible next to the action buttons without opening the chat or another page

#### Scenario: After-the-fact look is worded differently

- **WHEN** a card shows a `plan_approval` that was answered and then marked **looked at**, with the review timestamp after `answeredAt`
- **THEN** the card says the conductor looked after the answer, not merely that the conductor looked

#### Scenario: After-the-fact concern is worded differently and still shown

- **WHEN** a card shows a `merge_approval` that was answered and then marked **looked at, with concerns**, with the review timestamp after `answeredAt`
- **THEN** the card says the look arrived after the answer and still shows the concern summary

#### Scenario: A question card has no review line

- **WHEN** a `question` decision is shown as a card
- **THEN** the card has no conductor-review line, whatever other decisions on the same ticket show

#### Scenario: Needs you and the ticket page agree with chat

- **WHEN** the same open `plan_approval` is shown in the conductor chat, in `Needs you`, and on the ticket page
- **THEN** all three cards show the same review state and, when there is one, the same concern summary

#### Scenario: A live web card picks up a mark without reload

- **WHEN** an open `plan_approval` card is on screen as **not looked at yet** and the conductor then marks it **looked at, with concerns**
- **THEN** that card updates to show the concern state and the summary without the human reloading the page

#### Scenario: Telegram does not grow a second approve card

- **WHEN** a channel has already pushed an answerable card for an open `merge_approval`, and the conductor later marks it **looked at, with concerns**
- **THEN** the channel does not send a second answerable card with Approve / Request changes buttons
