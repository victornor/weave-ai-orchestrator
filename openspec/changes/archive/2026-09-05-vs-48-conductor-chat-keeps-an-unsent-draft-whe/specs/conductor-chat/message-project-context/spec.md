## MODIFIED Requirements

### Requirement: The selector defaults to the thread's last choice

When the chat opens a thread, the selector SHALL default to the project carried by the most recent human message in that thread, and SHALL default to "no project" when that message carried none or when the thread has no human messages yet.

The default SHALL be derived from the thread's own stored messages, so the same thread opened on another device offers the same default.

A choice the human made for a message they have not sent yet SHALL take precedence over that default while the draft it belongs to lasts, so leaving the page and returning offers the message back as it was being written. Once the draft is gone, the default is the thread's last choice again.

#### Scenario: Reopening a thread whose last message named a project

- **WHEN** the human opens a thread whose most recent message carried a project
- **THEN** the selector shows that project as the current choice

#### Scenario: Reopening a thread whose last message named no project

- **WHEN** the human opens a thread whose most recent message carried no project
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: A thread with no messages

- **WHEN** the human opens a thread that has no messages yet
- **THEN** the selector shows the "no project" option as the current choice

#### Scenario: Changing the choice within a session

- **WHEN** the human changes the selection and sends a message
- **THEN** subsequent messages in that session default to the new choice, and it remains the default after the chat is reloaded

#### Scenario: Choosing a project for a message that has not been sent

- **WHEN** the human changes the selection, does not send, leaves the page and returns to the thread
- **THEN** the selector still shows the project they chose
