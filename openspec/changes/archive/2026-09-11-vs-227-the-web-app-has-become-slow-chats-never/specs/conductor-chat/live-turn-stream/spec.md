## ADDED Requirements

### Requirement: The in-flight send label ends when the send settles

The composer’s in-flight send label (“Sending…”, or the attachment wording) SHALL last only while the send request is in flight, as `conductor-chat/composer-send-lifecycle` defines. The chat’s working indicator — that the conductor is taking a turn — is a separate display. A successful send SHALL NOT keep the in-flight send label up until `run.finished`.

The working indicator MAY still appear as soon as the human sends, and stay until the turn finishes, including when live streams are down, so long as it is not the send-in-flight wording.

#### Scenario: POST succeeded, stream has not delivered run.finished

- **WHEN** the human’s send request completes successfully and no `run.finished` event has arrived
- **THEN** the composer is no longer showing the in-flight send label, and the chat may still show that the conductor is working

#### Scenario: POST succeeded, stream is not connected

- **WHEN** the human’s send request completes successfully while the workspace live stream is not connected
- **THEN** the composer is no longer showing the in-flight send label
