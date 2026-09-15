## ADDED Requirements

### Requirement: Chat can be opened with a prompt already in the composer

The chat screen SHALL accept a one-shot seeded prompt handed to it by another screen and place that
text in the composer of the workspace's conversation, unsent and editable, once the conversation is
resolved — including when the conversation has to be created first. A seed SHALL be consumed once
and SHALL NOT reappear on a later visit or in another workspace, and it SHALL NOT send a message by
itself.

#### Scenario: A seeded prompt lands in the composer

- **WHEN** another screen opens the workspace's chat with a seeded prompt
- **THEN** the composer shows that prompt, unsent and editable, in that workspace's conversation

#### Scenario: The conversation is created for the seed

- **WHEN** the workspace has no conversation yet and chat is opened with a seed
- **THEN** the conversation is created and the seed is placed in its composer

#### Scenario: A seed is one-shot

- **WHEN** a seeded prompt has been shown and the person leaves and returns to chat
- **THEN** the prompt does not reappear unless it is sent as a draft

#### Scenario: A seed does not cross workspaces

- **WHEN** a prompt is seeded for one workspace
- **THEN** no other workspace's composer shows it
