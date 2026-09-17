## ADDED Requirements

### Requirement: Escape cancels an active dictation without sending

While a V2 dictation is listening or transcribing, pressing Escape SHALL cancel it: the microphone
is released, any transcription request already in flight is abandoned, the dictated text is
discarded, and the composer draft is restored to the exact value it held before dictation started.
No message SHALL be submitted, including when "Send automatically when dictation ends" is on.
Cancelling SHALL be reachable from both the in-composer dictation UI and the off-page dictation bar.
When no dictation is active, Escape SHALL keep whatever meaning it had on that surface unchanged.

#### Scenario: Escape while listening cancels and sends nothing with auto-send on

- **WHEN** auto-send is on and a dictation is listening
- **THEN** pressing Escape stops the recording, restores the draft that was in the composer before the
  mic opened, and submits nothing

#### Scenario: Escape while transcribing cancels and sends nothing

- **WHEN** a Voxtype dictation has stopped recording and its transcription is in flight
- **THEN** pressing Escape discards the attempt, restores the pre-dictation draft, and submits nothing

#### Scenario: Escape from the off-page dictation bar cancels

- **WHEN** a dictation is active and its off-page bar is shown
- **THEN** pressing Escape cancels the recording by the same path and sends nothing

#### Scenario: Escape keeps its other meaning when no dictation is active

- **WHEN** no dictation is listening or transcribing and the human presses Escape on a surface that
  already assigns it a meaning (closing a sheet or modal, clearing a composer, resetting a pane
  separator)
- **THEN** that surface's existing Escape behaviour happens unchanged

### Requirement: Ending a dictation leaves the transcript and never sends

Ending a dictation by any of its own gestures — the composer's dictate control, the off-page bar's
Stop, or the hotkey's release or toggle-off — SHALL end the session and leave the settled transcript
in the composer. It SHALL NOT submit a message. Only an explicit send (the send keybinding or the
Send button) SHALL submit, through the queued finish-the-dictation-and-send path. Escape remains
distinct: it discards the transcript and restores the pre-dictation draft, also submitting nothing.

#### Scenario: The dictate control leaves the transcript

- **WHEN** a dictation is listening and the human presses the composer's dictate control to stop it
- **THEN** the session ends, the recognized text is left in the composer, and no message is submitted

#### Scenario: The off-page bar's Stop leaves the transcript

- **WHEN** a session ends from the off-page bar's Stop
- **THEN** the settled transcript is left in the target thread's composer and no message is submitted

#### Scenario: A hotkey release or toggle-off leaves the transcript

- **WHEN** a push-to-talk hold is released, or a toggle session is pressed off, past the hold threshold
- **THEN** the transcript is left in the composer and no message is submitted

#### Scenario: Only an explicit send submits

- **WHEN** a dictation is listening or transcribing and the human presses the send keybinding or the
  Send button
- **THEN** the session finishes and the settled transcript is submitted exactly once, through the
  queued send path

#### Scenario: Escape still discards rather than leaving the transcript

- **WHEN** a dictation is listening or transcribing and the human presses Escape
- **THEN** the transcript is discarded, the draft is restored to its pre-dictation value, and
  nothing is submitted
