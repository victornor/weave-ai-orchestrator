## MODIFIED Requirements

### Requirement: A draft ends when the message is sent or the field is cleared

A *confirmed* send SHALL clear its draft, so returning to the page afterwards finds an empty composer.
A send that fails SHALL NOT clear the draft: the human's unsent words are not distinguishable from a
draft they are still working on until the send is known to have succeeded. Clearing the field by hand
SHALL clear the draft too — a composer the human emptied SHALL NOT refill itself on return.

A draft SHALL NOT be created for a composer that has never been written in.

#### Scenario: After sending

- **WHEN** the human sends the message they drafted, it is confirmed sent, and they later return to the
  page
- **THEN** the composer is empty

#### Scenario: Thinking better of it

- **WHEN** the human deletes what they had written and leaves the page
- **THEN** the composer is empty when they return

#### Scenario: A failed send keeps the draft

- **WHEN** the human sends a drafted message, the send fails, and they navigate away and back before
  retrying
- **THEN** the composer still holds the same text, as if it had never been sent

### Requirement: The reply reference and the project tag are kept with the draft

In the conductor chat, the message being replied to and the project chosen beside the input SHALL be
kept with the draft they were chosen for, and SHALL be restored with it. A *confirmed* send SHALL clear
the reply reference exactly as it does today; a failed send SHALL leave the reply reference and the
chosen project exactly as they were, alongside the retained text. The project pick SHALL remain the
default for the next message after a confirmed send, as it does today.

#### Scenario: Coming back to a drafted reply

- **WHEN** the human chooses a conductor message to reply to, chooses a project, types a message,
  leaves the page and returns
- **THEN** the quote and the project are shown as they were, and sending carries both

#### Scenario: A failed send keeps the reply reference

- **WHEN** the human sends a reply that is scoped to a message and a project, and the send fails
- **THEN** the reply reference and the project pick are still shown on the composer afterwards
