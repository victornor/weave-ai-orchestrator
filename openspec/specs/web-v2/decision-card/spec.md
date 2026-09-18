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

### Requirement: A merge approval card shows the live status of the checks it is waiting on

Every `merge_approval` card SHALL show a compact chip describing the ticket's recorded check state for
its pull request, wherever the card renders — Needs you, the chat pane, and the ticket page — derived
from data the daemon has already recorded. The card SHALL NOT poll the forge itself. The chip SHALL
name the individual checks where the state calls for it, and SHALL be updated live as the recorded
check state changes, with no page reload.

The chip SHALL say exactly one of the following, from the recorded rolled-up state and tally:

- while any check is queued or running: `Waiting for CI` with the passed-out-of-total tally, and the
  pending checks' names available on the card (hover or expand);
- when every check has completed successfully: `CI passed`;
- when any check has failed: `CI failed` naming at least the first failed check;
- when every reported check was skipped: `CI skipped` — an all-skipped rollup SHALL NOT read as a pass;
- when the recorded checks describe a commit other than the head the card is approving: a stale
  indication (`CI on an older commit`) in place of the tally.

A pull request with no recorded checks SHALL show no chip, and a card whose ticket has no pull request
SHALL show no chip.

The chip SHALL appear on an unreviewed card exactly as on a reviewed one, so a card nobody has looked
at and a card waiting on CI are distinguishable by more than the review line.

#### Scenario: Checks still running

- **WHEN** a merge approval card's ticket has a recorded rollup of two passed checks out of four with two queued
- **THEN** the card shows `Waiting for CI` with `2/4` and can name the two pending checks

#### Scenario: All checks passed

- **WHEN** every check in the recorded rollup has completed successfully
- **THEN** the card shows `CI passed`

#### Scenario: A check failed

- **WHEN** one check in the recorded rollup has failed
- **THEN** the card shows `CI failed` and names the failed check

#### Scenario: Every check skipped

- **WHEN** the recorded rollup contains only skipped checks
- **THEN** the card shows `CI skipped` and does not read as a pass

#### Scenario: Checks are for an older commit

- **WHEN** the recorded checks describe a head that differs from the head the card is approving
- **THEN** the card shows the stale indication `CI on an older commit` instead of a tally

#### Scenario: No checks recorded

- **WHEN** the ticket's pull request records no checks
- **THEN** the card shows no CI chip

#### Scenario: The chip updates without a reload

- **WHEN** the recorded check state for a rendered merge approval card changes while the card is on screen
- **THEN** the chip reflects the new state without a page reload and without the card asking the forge

#### Scenario: An unreviewed card still shows its CI state

- **WHEN** a merge approval card is unreviewed and its checks are still pending
- **THEN** the card shows its unreviewed wording and the `Waiting for CI` chip together

### Requirement: The card shows the weaver's waiting statement

When an open review-carrying decision carries a review `waitingOn`, the card SHALL render it as a line
of its own, distinct from the review outcome line and its note, attributed to the weaver. A decision
whose review carries no waiting statement SHALL render no such line.

#### Scenario: A card with a waiting statement

- **WHEN** an open merge approval card is rendered and its review carries a `waitingOn`
- **THEN** the card shows that statement as a distinct weaver-attributed line

#### Scenario: A card without one

- **WHEN** an open merge approval card is rendered and its review carries no `waitingOn`
- **THEN** no waiting line appears

### Requirement: Free-text surfaces on a decision card offer dictation

Every free-text surface on the V2 decision card SHALL offer voice dictation: the free-text answer on
a card with options, a `text` input, a `multiline` input, and the written answer of a
`single_choice` input whose `allowOther` is set. Dictation SHALL be the same control and the same
behaviour as the V2 chat composer's — the same start and stop affordance, the same in-progress
state while listening and while transcribing, and the same insertion of the recognised speech into
whatever text the field already holds rather than replacing it. A card SHALL NOT carry a second,
divergent dictation implementation. A `secret` input SHALL NOT offer dictation, because its value
exists to stay out of the ordinary transcription path. A transcript discarded by the shared
minimum-word rule SHALL leave the field exactly as it was, and SHALL NOT submit anything.

#### Scenario: The free-text answer on a card with options offers dictation

- **WHEN** a card with options is open and the human opens its "write your own" answer
- **THEN** that answer offers a dictate control that starts and stops dictation and inserts the
  recognised speech into the answer text

#### Scenario: A multiline input offers dictation

- **WHEN** an open card carries a `multiline` input
- **THEN** that input offers the dictate control and inserts the recognised speech into its value

#### Scenario: A text input offers dictation

- **WHEN** an open card carries a `text` input
- **THEN** that input offers the dictate control and inserts the recognised speech into its value

#### Scenario: A single-choice input with allowOther offers dictation on the written answer

- **WHEN** an open card carries a `single_choice` input with `allowOther` and the human chooses to
  write their own answer
- **THEN** that written answer offers the dictate control and inserts the recognised speech into it

#### Scenario: A secret input does not offer dictation

- **WHEN** a card carries a `secret` input
- **THEN** that input offers no dictate control and remains keyboard-only

#### Scenario: Dictation inserts into existing text

- **WHEN** a card's free-text surface already holds typed text and the human dictates a phrase
- **THEN** the recognised phrase is inserted after the existing text, through the same control and
  behaviour the chat composer uses

#### Scenario: A too-short transcript leaves the card field unchanged

- **WHEN** a card field's dictation ends with a transcript below the shared minimum-word rule
- **THEN** the field is restored to exactly what it held before the mic opened and nothing is
  submitted

### Requirement: An approval card shows the ticket's attached evidence

Every `plan_approval`, `merge_approval` and `action_approval` card SHALL show the attachments of the
ticket it decides, wherever the card renders — Needs you, the chat pane, and the ticket page. Image
attachments SHALL render as previews inside the card and SHALL be viewable at full size without
leaving the card. Non-image attachments SHALL NOT be dropped: each SHALL render as its label, media
type and byte size with a download. The attachments SHALL be the ticket's own attachments, shown
newest first, each labelled with when it was captured; the card SHALL NOT filter them to the commit or
document revision being approved. A ticket with no attachments SHALL render the card exactly as
before, with no empty section and no reserved space. A card whose ticket detail is still loading or
cannot be read SHALL render as before rather than show an error or a placeholder.

#### Scenario: A screenshot appears on the approval card

- **WHEN** a worker attaches a PNG to its ticket and the ticket's plan, merge or action approval card
  is rendered
- **THEN** the image is visible inside the card, without navigating away from the card

#### Scenario: Full size without leaving the card

- **WHEN** the human opens an image shown on an approval card
- **THEN** the image is shown at full size over the card and can be dismissed back to it

#### Scenario: Several images and a non-image

- **WHEN** a ticket has more than one image attachment and a non-image attachment
- **THEN** the images render as previews and the non-image renders as a labelled download, and none is
  dropped

#### Scenario: Newest evidence first, labelled with its age

- **WHEN** a ticket has attachments captured at different times
- **THEN** the newest is shown first and each item shows when it was captured

#### Scenario: A card with no attachments is unchanged

- **WHEN** an approval card's ticket has no attachments
- **THEN** the card renders exactly as it does today, with no attachments section and no reserved
  space

#### Scenario: The ticket read has not arrived

- **WHEN** an approval card renders before its ticket detail has loaded, or the read fails
- **THEN** the card renders as it does today, with no error and no placeholder

#### Scenario: The evidence appears on every card surface

- **WHEN** the same approval card renders on Needs you, in the chat pane, and on the ticket page
- **THEN** each surface shows the ticket's attached evidence

### Requirement: The approve control and the reviewed-clean line are the same in both themes

The decision card's available Approve control SHALL read as the same inverse high-contrast action in
the dark theme and the light theme: a dark fill with white ink in light mode, and a near-white fill
with dark ink in dark mode, with no hue on the control in either theme. Green SHALL be removed from
the Approve control entirely. A blocked Approve SHALL use the same recipe in both themes, so a
disabled action does not look like a different control per theme.

The weaver's reviewed-clean line SHALL be the same green hue in both themes, at whatever lightness
each theme's ground needs for contrast, rather than a different hue per theme.

#### Scenario: The approve control in both themes

- **WHEN** an available Approve control is rendered in the dark theme and in the light theme
- **THEN** it is the inverse pair in both — dark fill with white ink in light, near-white fill with
  dark ink in dark — with no green in either, and each fill's own ink meets contrast

#### Scenario: A blocked approve is the same recipe

- **WHEN** an Approve control is blocked and rendered in the dark theme and in the light theme
- **THEN** it uses the same blocked recipe in both themes

#### Scenario: The reviewed-clean line is one hue

- **WHEN** the reviewed-clean line is rendered in the dark theme and in the light theme
- **THEN** it is the same green hue in both, at each theme's own lightness
