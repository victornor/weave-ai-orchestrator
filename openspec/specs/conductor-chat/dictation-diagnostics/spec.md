# conductor-chat/dictation-diagnostics Specification

## Purpose
Lets a human dictating on a device a worker cannot reach capture and hand back the raw recognizer
events behind a dictation bug, so a fix can be diagnosed from a real recording instead of a guessed
event sequence.

## Requirements

### Requirement: Diagnostics capture is off by default and requires explicit opt-in

The composer SHALL record no dictation diagnostics unless a human has explicitly turned the
capture on for the current session. Turning it on SHALL be a deliberate action distinct from
starting dictation itself.

#### Scenario: Dictating without ever opting in

- **WHEN** a human dictates without ever enabling diagnostics capture
- **THEN** no dictation event log is recorded

#### Scenario: Opting in for one session

- **WHEN** a human enables diagnostics capture and then dictates
- **THEN** the dictation events from that point on are recorded

### Requirement: The capture records what the recognizer sent and what the composer showed

While enabled, the capture SHALL record, for every recognizer `result` event, that event's result
index and, for every entry it carries, whether it was final and its transcript, together with the
composer's text immediately after that event was handled. It SHALL also record every point at which
a recognition session ended and whether dictation restarted a new one.

#### Scenario: A full dictation session

- **WHEN** a human dictates a sentence with diagnostics enabled, including a restart mid-utterance
- **THEN** the capture holds, in order, every recognizer event's index and entries, every restart
  boundary, and the composer's text after each step

### Requirement: The capture leaves the device only when a human deliberately copies it out

The capture SHALL NOT be sent over the network or persisted anywhere outside the current browsing
session. The only way its contents leave the device SHALL be a human copying it, on their own
action, to the clipboard.

#### Scenario: Copying the capture

- **WHEN** a human with a non-empty capture activates the copy control
- **THEN** the capture's contents are placed on the clipboard, and nothing is sent anywhere else

#### Scenario: No background transmission

- **WHEN** diagnostics capture is enabled and recording
- **THEN** no network request carries the capture's contents, and reloading or closing the tab
  leaves nothing behind
