## REMOVED Requirements

### Requirement: The composer is locked while a non-streaming backend is recording or transcribing

**Reason**: Sending is being taken out of the lock (VS-282): it becomes the way to finish the
dictation, not something disabled by it. The text-entry and attach locking, and the stop-control
availability, are unchanged and are re-stated under the added requirement "The composer locks text
entry and attachments while a non-streaming backend is recording or transcribing".

**Migration**: The unchanged textarea/attach/stop behaviour lives in that added requirement; the new
send behaviour lives in "Send finishes a non-streaming dictation and sends the transcript". Nothing
is lost: every scenario below is carried forward, with the send scenario re-specified as available
rather than disabled.

#### Scenario: The textarea cannot be edited while recording

- **WHEN** the active backend is non-streaming and the human starts dictating
- **THEN** the composer's text input does not accept typed input until the attempt ends

#### Scenario: Sending is unavailable mid-dictation

- **WHEN** the active backend is non-streaming and the human is recording or waiting on a transcript
- **THEN** the send control does not accept a send

#### Scenario: Stopping remains possible while recording

- **WHEN** the active backend is non-streaming and the human is recording
- **THEN** the control that stops the recording is available and stops it

## ADDED Requirements

### Requirement: The composer locks text entry and attachments while a non-streaming backend is recording or transcribing

While the active dictation backend is non-streaming and is either recording or transcribing, the
composer SHALL disable text entry and attaching a file, so nothing the human types or taps is lost or
race-conditioned against the pending transcript. Sending is not covered by this lock; it is governed
by "Send finishes a non-streaming dictation and sends the transcript". The control that stops
recording SHALL remain available while recording, and SHALL itself be disabled while transcribing,
since there is nothing left for it to stop.

#### Scenario: The textarea cannot be edited while recording

- **WHEN** the active backend is non-streaming and the human starts dictating
- **THEN** the composer's text input does not accept typed input until the attempt ends

#### Scenario: Attaching is unavailable mid-dictation

- **WHEN** the active backend is non-streaming and the human is recording or waiting on a transcript
- **THEN** the attach control does not accept a file

#### Scenario: Stopping remains possible while recording

- **WHEN** the active backend is non-streaming and the human is recording
- **THEN** the control that stops the recording is available and stops it

### Requirement: Send finishes a non-streaming dictation and sends the transcript

While the active dictation backend is non-streaming and is recording or transcribing, the send control
SHALL be available and SHALL mean "finish the dictation and send it": if recording, it stops the
dictation; it then waits, and submits the message the moment the transcript has landed in the
composer. The submitted message SHALL be built from the composer's state at the moment the transcript
lands, so it contains the transcript rather than text captured before it. While the send is pending,
the composer SHALL show that the message is queued waiting on the transcript. Exactly one message
SHALL be submitted per queued send, however many times the send control is pressed and whether or not
the mic's stop control is used. On a failed or empty transcript the pending send SHALL clear, the
composer SHALL remain usable with whatever text exists, the human SHALL be told, and nothing empty
SHALL be submitted.

#### Scenario: Sending while recording stops and then sends the transcript

- **WHEN** the active backend is non-streaming, the human is recording, and they press send
- **THEN** the recording stops, and once the transcript lands the message is submitted in one action

#### Scenario: Sending while already transcribing sends when the transcript lands

- **WHEN** the active backend is non-streaming and the human presses send after recording has already
  stopped but before the transcript has arrived
- **THEN** no second recording starts and the message is submitted once the transcript lands

#### Scenario: The submitted message contains the transcript, not the pre-transcript text

- **WHEN** the composer held text when send was pressed and the transcript that later lands differs
  from it
- **THEN** the submitted message contains the transcript

#### Scenario: A pending send is shown while waiting

- **WHEN** the active backend is non-streaming and a send is waiting on a transcript
- **THEN** the composer shows that the message is queued waiting on the transcript, rather than an
  inert send control or no sign that the press was received

#### Scenario: A queued send submits exactly one message

- **WHEN** the send control is pressed more than once while a non-streaming dictation is recording or
  transcribing, or the mic's stop control is used after a send was pressed
- **THEN** exactly one message is submitted

#### Scenario: An empty transcript clears the pending send and sends nothing

- **WHEN** a queued send's transcript comes back empty and there was no typed text
- **THEN** the pending send clears, nothing is submitted, and the human is told

#### Scenario: A failed transcript clears the pending send and leaves the composer usable

- **WHEN** a queued send's transcription fails
- **THEN** the pending send clears, nothing is submitted, the composer is usable again with whatever
  text exists, and the human is told

### Requirement: The streaming backend's send path is unchanged

The finish-and-send behaviour above SHALL apply only to the non-streaming backend. While the active
dictation backend is streaming, sending SHALL behave exactly as it did before this capability: the
message is submitted immediately from the composer's live text, with no queue, no waiting on a
transcript, and no pending indication.

#### Scenario: Streaming send is immediate and unqueued

- **WHEN** the active backend is streaming, the human is dictating, and they press send
- **THEN** the message is submitted immediately from the live text, with no pending state
