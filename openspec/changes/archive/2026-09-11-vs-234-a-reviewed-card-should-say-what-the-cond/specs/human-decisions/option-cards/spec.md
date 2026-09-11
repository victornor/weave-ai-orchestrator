## MODIFIED Requirements

### Requirement: A plan, merge or action approval card shows whether the conductor has looked

Every surface that renders a `plan_approval`, `merge_approval`, or `action_approval` as a card — the conductor chat (pinned and in history), `Needs you`, the ticket page, the TUI, and `conductor decision show` — SHALL show that decision's conductor review state.

Each of the three states SHALL have its own visible rendering. No state SHALL be conveyed by omitting the review line: a blank would make **looked at** indistinguishable from **not looked at yet**, which is the distinction this requirement exists to make.

The copy SHALL state the outcome of the review rather than the bare activity, and SHALL claim no more than the mark asserts. Exactly this weight:

- **not looked at yet** — loud: the card shows the text `Conductor hasn't reviewed yet`
- **looked at** — conclusive but not a sign-off: the card shows the text `Conductor reviewed — no concerns` (or the after-the-fact variant). It SHALL NOT use a green seal, a checkmark of approval, or the words "signed off" / "approved by the conductor", and SHALL NOT be hidden, collapsed, or left as whitespace
- **looked at, with concerns** — loudest: the card shows `Conductor reviewed — has concerns` (or the after-the-fact variant)

A mark made after notes were required carries its note, and the card SHALL show that note next to the action buttons — a clean mark's stated reason exactly as a concern's summary is shown — so the human reads the conductor's conclusion and its justification at the moment of the decision rather than hunting the chat for it. A mark made before notes were required carries none; such a card SHALL still show the review line, sensibly, without a note. The line and note SHALL NOT claim the conductor approved, signed off, or vouches for the work: approving is the human's act.

When `reviewedAt` is strictly later than `answeredAt`, the card SHALL say that the look arrived after the answer, distinct from a look that arrived before. An unanswered card never uses after-the-fact wording.

A card for any other decision kind SHALL NOT show a conductor review line.

Showing the review state SHALL NOT disable, delay, hide, or relabel any action the card already offers. The buttons stay the same keys, the same number, and the same immediate send.

A later review on an already-shown card SHALL become visible without a reload on any surface that already refreshes a live decision (the web app over the workspace event stream). A channel that pushed the card once as an outbound message SHALL NOT send a second answerable card with a duplicate set of approve buttons; if it surfaces a later **looked at, with concerns** at all, it does so as text, not as a new decision to answer.

#### Scenario: An unseen plan card says the conductor has not looked

- **WHEN** an open `plan_approval` whose review state is **not looked at yet** is shown as a card
- **THEN** the card says the conductor has not reviewed yet
- **AND** its Approve, Revise and Reject actions are enabled and send the same keys they send today

#### Scenario: A looked-at merge card is quiet

- **WHEN** an open `merge_approval` whose review state is **looked at** is shown as a card, its mark carrying a note
- **THEN** the card shows that the conductor reviewed it and found nothing to object to, with the note visible next to the action buttons without opening the chat or another page
- **AND** the rendering does not present the mark as an approval, a sign-off, or a green endorsement
- **AND** its Approve merge and Request changes actions are unchanged

#### Scenario: A clean look is never a blank

- **WHEN** an open `plan_approval` whose review state is **looked at** is shown as a card
- **THEN** the review line is visible and reads as the conclusion of a review, not as a log entry
- **AND** a reader can tell it apart from a card whose review state is **not looked at yet** without relying on the line being absent

#### Scenario: A mark from before notes were required still renders

- **WHEN** a card shows a decision whose review state is **looked at** and whose mark carries no note
- **THEN** the card shows the review line without a note, with nothing blank, broken, or filler where a note would sit

#### Scenario: A concern sits next to the buttons

- **WHEN** an open `merge_approval` whose review state is **looked at, with concerns** is shown as a card
- **THEN** the card says the conductor reviewed it and has concerns
- **AND** the concern summary is visible next to the action buttons without opening the chat or another page

#### Scenario: After-the-fact look is worded differently

- **WHEN** a card shows a `plan_approval` that was answered and then marked **looked at**, with the review timestamp after `answeredAt`
- **THEN** the card says the conductor reviewed it after the answer, not merely that the conductor reviewed it

#### Scenario: After-the-fact concern is worded differently and still shown

- **WHEN** a card shows a `merge_approval` that was answered and then marked **looked at, with concerns**, with the review timestamp after `answeredAt`
- **THEN** the card says the look arrived after the answer and still shows the concern summary

#### Scenario: A question card has no review line

- **WHEN** a `question` decision is shown as a card
- **THEN** the card has no conductor-review line, whatever other decisions on the same ticket show

#### Scenario: Needs you and the ticket page agree with chat

- **WHEN** the same open `plan_approval` is shown in the conductor chat, in `Needs you`, and on the ticket page
- **THEN** all three cards show the same review state and, when there is one, the same note

#### Scenario: A live web card picks up a mark without reload

- **WHEN** an open `plan_approval` card is on screen as **not looked at yet** and the conductor then marks it **looked at, with concerns**
- **THEN** that card updates to show the concern state and the summary without the human reloading the page

#### Scenario: Answering a reviewed card is unchanged

- **WHEN** the human approves an open card whose review state is **looked at**, with or without a note
- **THEN** the answer is recorded at once with the same keys and effect as on an unseen card, and nothing in the answer path waited on the review or its note

#### Scenario: Telegram does not grow a second approve card

- **WHEN** a channel has already pushed an answerable card for an open `merge_approval`, and the conductor later marks it **looked at, with concerns**
- **THEN** the channel does not send a second answerable card with Approve / Request changes buttons
