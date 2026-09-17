# conductor-chat/composer-drafts Specification

## Purpose
Keeps an unsent message from silently disappearing when the human navigates away: the text, its
reply reference and its project tag are held per conversation in a workspace, survive leaving and
returning, and end only when the message is sent or the field is cleared.

## Requirements

### Requirement: An unsent message is kept while the human is elsewhere in the app

The web app SHALL keep the unsent contents of a composer when the human navigates away from the page it is on, and SHALL restore them when they return to that page. This SHALL hold for the conductor chat's composer and for the composer that replies to a ticket.

A restored draft SHALL be presented ready to continue: the text as it was, with the caret after it rather than before it.

A draft SHALL survive reloading the tab. It SHALL NOT be carried to another device, and it SHALL NOT outlive the browsing session, so a shared device does not offer one person's unsent words to the next.

Whatever dictation transcribed into the composer before the human left SHALL be kept exactly as typed text is. Leaving the page SHALL still stop dictation.

#### Scenario: Leaving the chat mid-sentence and coming back

- **WHEN** the human types into the conductor chat's composer without sending, navigates to another page, and returns to the chat
- **THEN** the composer holds the same text, with the caret at the end of it

#### Scenario: Reloading the tab

- **WHEN** the human reloads the tab while a composer holds an unsent message
- **THEN** the composer holds the same text after the reload

#### Scenario: Coming back to a ticket's reply box

- **WHEN** the human types a reply on a ticket without sending it, leaves the ticket, and returns
- **THEN** the reply box holds the same text

#### Scenario: A dictated message interrupted by leaving the page

- **WHEN** the human dictates into the composer and navigates away before sending
- **THEN** dictation stops as it does today, and what was transcribed is held as the draft and restored on return

### Requirement: A draft belongs to one conversation in one workspace

A draft SHALL be identified by the workspace it was written in and the conversation it was written for. A draft written in one workspace SHALL NOT appear in another, and a draft written for one conversation SHALL NOT appear in another.

Opening a different conversation SHALL present that conversation's own draft, or an empty composer where it has none, and SHALL leave the draft that was left behind untouched.

Composers that post to the same conversation SHALL share its draft.

#### Scenario: Two workspaces open in turn

- **WHEN** the human drafts a message in one workspace and then opens the same view in another workspace
- **THEN** the composer there is empty, and the first workspace's draft is still there when they go back

#### Scenario: Switching thread

- **WHEN** the human drafts a message in one thread and switches to another
- **THEN** the composer shows the second thread's draft, or nothing if it has none, and the first thread's draft is unchanged

#### Scenario: The same ticket from two places

- **WHEN** the human starts a reply to a ticket on the ticket page and then opens the page of the worker on that ticket
- **THEN** the steer composer there holds the same unsent reply

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

### Requirement: The chosen roadmap block is kept with the draft

In the conductor chat, the roadmap block chosen beside the input SHALL be kept with the draft it was
chosen for, alongside the text, the reply reference and the project, and SHALL be restored with it.
A *confirmed* send SHALL clear the chosen block together with the project; a send that fails SHALL
leave it exactly as it was, alongside the retained text.

#### Scenario: Coming back to a drafted message with a block chosen

- **WHEN** the human chooses a project, chooses one of that project's blocks, types a message, leaves
  the page and returns
- **THEN** the block is shown as chosen alongside the project, and sending carries both

#### Scenario: A failed send keeps the chosen block

- **WHEN** the human sends a message scoped to a project and a block, and the send fails
- **THEN** the block and the project are still shown on the composer afterwards

#### Scenario: A confirmed send clears the chosen block

- **WHEN** the human sends a message with a block chosen and the send is confirmed
- **THEN** the block choice is cleared, and reloading the chat does not restore it
