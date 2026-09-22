## MODIFIED Requirements

### Requirement: A session's attachment reaches the agent

An attachment on a message to a session SHALL reach the session agent in the form the session's runtime
can take, through the same mechanism a conductor chat message uses. The turn prompt SHALL name that the
message carried attachments. On a runtime that can take an image, the agent's inbox SHALL return an
image's bytes as image content; on a runtime or model that cannot, the daemon SHALL write the image to
a readable path and SHALL name that path in the turn's prompt and in the agent's inbox entry for the
message, so the image is never silently dropped. A text document's literal content SHALL be delivered
on every runtime.

#### Scenario: The agent can read the attachment

- **WHEN** a session's turn was woken by a message carrying an image attachment on a runtime that can take an image, and the agent calls its inbox tool
- **THEN** the inbox result carries the image's content

#### Scenario: A runtime that cannot take an image gets a readable path

- **WHEN** a session's turn runs on a runtime or model that cannot take an image and was woken by a message carrying an image attachment
- **THEN** the turn's prompt names a readable path for that image, the agent's inbox entry for the message carries the same path, and the image is not dropped

#### Scenario: A text document keeps its literal content

- **WHEN** a session's message carries a text document attachment
- **THEN** the agent's inbox delivers its literal content, on every runtime

#### Scenario: The prompt names the attachment

- **WHEN** a session turn's prompt is built for a message that carried attachments
- **THEN** the prompt names that the message carried them, in the form the session's runtime can take