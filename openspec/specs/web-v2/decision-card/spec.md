# web-v2/decision-card Specification

## Purpose
The complete, answerable decision card V2 renders on Needs you and in the chat pane: every card kind
and input, the review states, the held state with its reasoned override, artifact reachability, and
the narrow-pane variant the chat pane embeds.

## Requirements

### Requirement: The decision card is complete on its own

V2 SHALL render a decision as a full answerable card, not a summary that points elsewhere. The card
SHALL carry a neutral header — `Needs you` or `Worker question` as plain text, with no coloured
status glyph — and SHALL name the ticket identifier and the project's identity. The card body SHALL
render the decision's context, the plan or action document when the decision's target points at one,
its options and its inputs. When the ticket the decision belongs to has a published artifact, the card
SHALL make that artifact reachable.

#### Scenario: A full card, not a summary

- **WHEN** a decision is rendered on Needs you or in the chat pane
- **THEN** its context, its options or inputs, and its document target are rendered in the card
  itself, with no link that sends the human elsewhere to read it

#### Scenario: A neutral header

- **WHEN** a card's header renders
- **THEN** it reads `Needs you` or `Worker question` in neutral text and carries no coloured status
  glyph

#### Scenario: An artifact is reachable when the ticket has one

- **WHEN** a card's ticket has a published artifact
- **THEN** the card offers a link to that artifact, and offers none when the ticket has no artifact

### Requirement: The three review states appear on cards only

Each decision SHALL expose a weaver review state of `unseen`, `looked` or `concerns`. The state SHALL
render on the decision card only, SHALL never appear as a board column or a ticket status, and SHALL
be derived from the decision rather than the ticket.

#### Scenario: An unreviewed decision

- **WHEN** an open decision has not been reviewed
- **THEN** its card states that the weaver has not reviewed it yet

#### Scenario: A reviewed decision

- **WHEN** a decision has been marked `looked` or `concerns`
- **THEN** the card states that outcome and the weaver's note, when there is one

#### Scenario: Not a board column

- **WHEN** a board or ticket list renders
- **THEN** it does not show a review state column or status for any ticket

### Requirement: Every kind of decision answers in the card

The card SHALL offer the controls the decision carries: option choices, free text, and the input
kinds `single_choice`, `multiselect`, `text`, `multiline` and `secret`. A `single_choice` input SHALL
present its choices with the recommended one marked, SHALL pre-select that recommendation, and SHALL
allow the human's own words when the input permits it. A `secret` input SHALL collect the value
without rendering it back and SHALL submit it under the asker's `secretName` rather than as the
answer. The card SHALL render a relayed answer as the human's words the weaver recorded. A required
input left empty SHALL keep the answer action unavailable and SHALL name the input still needed.

#### Scenario: A single-choice input

- **WHEN** a card carries a `single_choice` input with a recommended choice
- **THEN** that choice is marked recommended and pre-selected, and answering sends its key

#### Scenario: A secret input

- **WHEN** a card carries a `secret` input
- **THEN** the value is masked, is never shown again, and is submitted under its `secretName`

#### Scenario: A required input is empty

- **WHEN** a required input has no value
- **THEN** the answer action is unavailable and the card names the input still missing

#### Scenario: A relayed answer

- **WHEN** a decision was answered by the weaver relaying the human's message
- **THEN** the card says the human's words were recorded by the weaver

### Requirement: A held card blocks approval and offers a reasoned override

When the weaver holds a decision, the card SHALL show the weaver's objection in its own words, a
`Revision in progress · Nm` row with a pulsing dot and a **Watch** toggle, a disabled Approve action
with `Override…` beside it, and the statement that approval is blocked until a revision lands. The
Override action SHALL open a reason field, SHALL require a reason before it can be submitted, SHALL
state that the reason is recorded on the ticket and that the weaver stands down, and SHALL submit the
approving answer with the override flag and the reason. A card whose approving action is withheld
until the weaver's review SHALL offer the same override.

#### Scenario: The held card

- **WHEN** a decision is held by the weaver
- **THEN** the card shows the objection, the revision row with its Watch toggle, a disabled Approve,
  `Override…`, and the blocked-until-a-revision copy

#### Scenario: Override requires a reason

- **WHEN** the human opens Override and submits without a reason
- **THEN** the override is not sent and the card requires a reason

#### Scenario: Override and approve

- **WHEN** the human gives a reason and confirms
- **THEN** the approving answer is sent with the override flag and that reason, and the reason is
  recorded on the ticket

### Requirement: The narrow-pane chat variant

The card SHALL render a narrow-pane variant for the chat pane with the same anatomy sized for the
pane, carrying a link to the ticket's work product and an `Ask the worker` action.

#### Scenario: The chat variant

- **WHEN** a decision is rendered in the chat pane
- **THEN** it shows the same card anatomy sized for the narrow pane, with a work-product link and
  `Ask the worker`
