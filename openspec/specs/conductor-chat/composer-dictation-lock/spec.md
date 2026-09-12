# conductor-chat/composer-dictation-lock Specification

## Purpose
Governs what the composer shows and accepts while a non-streaming dictation backend is capturing
speech or transcribing it, so silence on screen is never mistaken for the feature being broken, and
guarantees the streaming backend is unaffected.

## Requirements

### Requirement: A listening indicator explains both halves of what is happening

While a non-streaming backend is recording, the composer SHALL show an indicator that states both
that speech is being captured right now, and that it will be transcribed once recording stops. This
indicator SHALL be visible regardless of viewport size, not hidden below a breakpoint.

#### Scenario: Starting a non-streaming dictation

- **WHEN** the active backend is non-streaming and the human starts dictating
- **THEN** the composer shows that speech is currently being captured, and that it will be processed
  once they stop

#### Scenario: The listening indicator is not hidden on a small viewport

- **WHEN** the active backend is non-streaming, the human is recording, and the viewport is narrow
- **THEN** the listening indicator is still visible

### Requirement: A distinct transcribing indicator covers the gap after recording stops

Once recording stops on a non-streaming backend, and until the transcript arrives or the attempt
ends, the composer SHALL show an indicator that is visually distinct from the listening indicator, so
the human can tell the two phases apart without reading text closely.

#### Scenario: Stopping a non-streaming dictation

- **WHEN** the active backend is non-streaming and the human stops recording
- **THEN** the listening indicator is replaced by a distinct transcribing indicator, shown until the
  transcript arrives or the attempt ends

### Requirement: The composer always returns to normal

The composer SHALL return to its normal editable, unlocked state, with both dictation indicators
gone, when a non-streaming dictation attempt ends for any reason: the transcript is inserted, the
transcript is empty, or the attempt fails.

#### Scenario: A successful transcript

- **WHEN** a non-streaming dictation attempt returns a transcript
- **THEN** the transcript is inserted and the composer is unlocked and editable again

#### Scenario: An empty transcript

- **WHEN** a non-streaming dictation attempt completes with no transcript text
- **THEN** the composer is unlocked and editable again, with nothing inserted

#### Scenario: A failed transcription request

- **WHEN** a non-streaming dictation attempt's transcription request fails
- **THEN** the composer is unlocked and editable again, and shows that the attempt failed

### Requirement: The streaming backend is unaffected

None of the locking or indicator behaviour above SHALL apply while the active dictation backend is
streaming. Its composer behaviour SHALL be exactly as it was before this capability existed.

#### Scenario: Streaming dictation is never locked

- **WHEN** the active backend is streaming and the human dictates
- **THEN** the composer's text input, attach control and send control are never disabled by
  dictation state, and no transcribing indicator appears

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
