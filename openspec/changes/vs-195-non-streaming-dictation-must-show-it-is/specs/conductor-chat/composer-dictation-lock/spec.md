## Purpose

Governs what the composer shows and accepts while a non-streaming dictation backend is capturing
speech or transcribing it, so silence on screen is never mistaken for the feature being broken, and
guarantees the streaming backend is unaffected.

## ADDED Requirements

### Requirement: The composer is locked while a non-streaming backend is recording or transcribing

While the active dictation backend is non-streaming and is either recording or transcribing, the
composer SHALL disable text entry, attaching a file, and sending, so nothing the human types or taps
is lost or race-conditioned against the pending transcript. The control that stops recording SHALL
remain available while recording, and SHALL itself be disabled while transcribing, since there is
nothing left for it to stop.

#### Scenario: The textarea cannot be edited while recording

- **WHEN** the active backend is non-streaming and the human starts dictating
- **THEN** the composer's text input does not accept typed input until the attempt ends

#### Scenario: Sending is unavailable mid-dictation

- **WHEN** the active backend is non-streaming and the human is recording or waiting on a transcript
- **THEN** the send control does not accept a send

#### Scenario: Stopping remains possible while recording

- **WHEN** the active backend is non-streaming and the human is recording
- **THEN** the control that stops the recording is available and stops it

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
