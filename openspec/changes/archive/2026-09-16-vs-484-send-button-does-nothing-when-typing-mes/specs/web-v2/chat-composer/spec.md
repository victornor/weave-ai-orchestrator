## ADDED Requirements

### Requirement: A typed send submits the composer's own draft, independent of the dictation session

When a shared dictation session is mounted above the composer (the V2 weaver chat), Send with typed
text SHALL submit the text in the composer's own draft. It SHALL NOT be a no-op because the session
has no target, or a target other than the thread being typed in. Only while a dictation is listening
or transcribing for this composer's thread SHALL Send carry its finish-the-dictation-and-send-the-
transcript meaning. Every other send guarantee — the idempotency key, the pending lock, a failed
send keeping the draft and its files, and the error shown near the input — is unchanged.

#### Scenario: Typed text sends with a shared session mounted but no dictation started

- **WHEN** the V2 weaver chat composer is inside the shared dictation session, no dictation has run,
  and the human types a message and presses Send
- **THEN** the message is posted to the current thread with the typed text

#### Scenario: Send while dictating in this thread finishes and sends the transcript

- **WHEN** a dictation is listening or transcribing for this composer's thread and the human presses
  Send
- **THEN** Send keeps its finish-and-send meaning: the recording stops and the transcript is
  submitted once it lands, exactly once

#### Scenario: A dictation for another thread does not capture this composer's typed send

- **WHEN** a dictation targets a different thread and the human types in this composer and presses
  Send
- **THEN** the typed text is posted to the thread being typed in, not to the dictation's target

#### Scenario: A rejected typed send keeps the draft

- **WHEN** a typed send with a shared session mounted is rejected
- **THEN** the failure is shown near the input and the typed text (and any staged files) remain for a
  retry
