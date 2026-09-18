## ADDED Requirements

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
