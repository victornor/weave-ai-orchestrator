# web-v2/chat-composer Specification

## Purpose
The V2 chat composer: the three controls that send a message to the weaver, the project scope it is
sent under, and the kept dictation, attachment and search capabilities of V1's composer in V2's language.

## Requirements

### Requirement: Three identical controls send, attach and dictate

The composer SHALL render three identically styled controls — attach, dictate and send — on the raised
surface with a hairline border and 6px corners, and no control SHALL be a pill. Attach SHALL open the
file picker and stage the chosen files; dictate SHALL start and stop dictation; send SHALL post the
typed text (and any staged files) to the thread. The input SHALL grow with its content and scroll
internally once it stops growing, and a second send while one is in flight SHALL not post twice.

#### Scenario: The three controls are present

- **WHEN** the composer is rendered
- **THEN** an attach control, a dictate control and a send control are present with the same styling

#### Scenario: Attaching and sending

- **WHEN** the human stages a file and sends a message
- **THEN** the message is posted with the file attached and the composer clears on the confirmed send

#### Scenario: An unconfirmed send keeps the draft

- **WHEN** a send fails
- **THEN** the composer keeps the text and the staged files so the attempt can be retried

#### Scenario: A failed send is reported

- **WHEN** the daemon rejects a send or the request times out
- **THEN** the composer shows the failure near the input, with the text and files still there to retry

### Requirement: A project scope selector above the composer

Above the input the composer SHALL offer a project scope selector leading with `Auto` and then each of
the workspace's projects in that project's hue. Choosing a project SHALL send it as the message's
`projectId`; `Auto` SHALL send no project. The selector SHALL clear to its default on a confirmed send.
A reply being composed SHALL be shown as a quote above the input and SHALL be dismissable or cleared on
send.

#### Scenario: Choosing a project

- **WHEN** the human picks a project and sends a message
- **THEN** the message is posted with that project's id

#### Scenario: Auto sends no project

- **WHEN** the human leaves the selector on Auto and sends a message
- **THEN** the message is posted without a project id

#### Scenario: Replying shows and clears a quote

- **WHEN** the human activates Reply on a message and then either sends or dismisses
- **THEN** the quote is shown while composing and cleared on the send or dismiss

### Requirement: Dictation is restyled to V2

Dictation SHALL be available from the composer's dictate control, tapping to toggle on touch and
push-to-talk at a desk. While recording, the composer SHALL show a live recording indicator restyled to
V2's Mono palette, and the recognized speech SHALL be appended to the input rather than replacing it.

#### Scenario: Recording in V2

- **WHEN** the human starts dictation
- **THEN** a recording indicator in V2's palette is shown and recognized speech is appended to the input

#### Scenario: The transcript appends to existing text

- **WHEN** the input already holds text and dictation recognizes a phrase
- **THEN** the phrase is appended after the existing text

### Requirement: Search and selection survive updates

The composer SHALL keep V1's thread search: a control that searches the thread's whole stored history,
shows the matches, and jumps the conversation to a chosen message. The conversation's message bodies
SHALL keep their DOM stable across an unrelated re-render, so a text selection a reader has made is not
cleared by a new message, a live trace tick, or a refetch.

#### Scenario: Searching the conversation

- **WHEN** the human opens search and types a query
- **THEN** matching messages are listed and choosing one moves the conversation to it

#### Scenario: A selection survives an update

- **WHEN** the reader has selected text in an older message and a new message arrives
- **THEN** the selected text's DOM node is unchanged and the selection remains

### Requirement: The unsent draft survives leaving the screen

The composer SHALL keep its unsent text, reply target and project choice per workspace and thread — the
same draft V1 keeps — so that leaving Chat for another screen and returning, or reloading, restores what
was being typed. The draft SHALL NOT cross a workspace or a thread, and SHALL clear on a confirmed send.
Staged attachments MAY be left out of the stored draft.

#### Scenario: Returning to Chat restores the draft

- **WHEN** the human types a message, navigates to another V2 screen, and comes back to Chat
- **THEN** the composer holds the text that was being typed

#### Scenario: A draft does not cross a thread

- **WHEN** the human switches to a different thread
- **THEN** the composer shows that thread's own draft, or an empty one, not the previous thread's

#### Scenario: A confirmed send clears the draft

- **WHEN** a message is sent successfully
- **THEN** the composer's stored draft for that thread is cleared

### Requirement: Attachments travel both ways

The composer SHALL accept image and plain-text files, up to the shared per-message limit, through the
picker, paste and drag, and SHALL send them in the same request as the message text. A message's
attachments SHALL render in the conversation, so a message sent with a file is readable as sent.

#### Scenario: Sending an attached file

- **WHEN** the human sends a message with a staged file
- **THEN** the file is uploaded with the message and the sent message shows the attachment

#### Scenario: Pasted or dropped files

- **WHEN** the human pastes or drops an accepted file onto the composer
- **THEN** the file is staged for the next send

### Requirement: The dictation meter never drives its own layout size

The listening waveform drawn by the composer's dictation meter SHALL NOT determine the size of any
element in the page. The element that allocates the meter's space SHALL be sized by the surrounding
layout and by CSS alone; the canvas's backing-store dimensions SHALL be derived from that box and
SHALL NOT feed back into it. In particular, growing the canvas's `width` or `height` attribute SHALL
NOT change the element's laid-out width or height.

#### Scenario: The meter holds its width across frames

- **WHEN** dictation is listening on a display with `devicePixelRatio` of 2 and the meter redraws
  across many frames
- **THEN** the meter's laid-out width is the same after several seconds as it was on the first frame

#### Scenario: The meter holds its width in any host

- **WHEN** the meter is rendered in a host that does not itself clamp the composer's width — as in
  the Plan modal — and the backing store is resized every frame
- **THEN** the meter and its ancestors do not widen, on any browser engine

#### Scenario: A wide meter does not widen the composer

- **WHEN** the listening waveform appears in the composer inside the Plan modal
- **THEN** the conversation pane's width is unchanged from before dictation started

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

### Requirement: How a dictation ends decides whether it sends

Ending a dictation with the composer's dictate control or the off-page dictation bar's Stop SHALL
end the session and leave the settled transcript in the composer; it SHALL NOT submit a message.
Ending it with the dictation keybinding — a toggle session pressed off, or a held chord released,
including the window-blur fallback that ends a hold whose keyup was lost — SHALL end the session
and, when the per-browser "Send automatically when dictation ends" setting is on, submit the
settled transcript through the queued finish-the-dictation-and-send path exactly once, once it
lands. With the setting off, the keybinding ending SHALL leave the transcript in the composer and
submit nothing. The setting SHALL be stored in the browser under the same key and with the same
semantics as before it was retired, so a human who had it on keeps it on; its default stays off.
Escape remains distinct: it discards the transcript and restores the pre-dictation draft,
submitting nothing. A too-short, empty or failed transcript SHALL submit nothing even with the
setting on, and only an explicit send (the send keybinding or the Send button) SHALL submit
regardless of the setting.

#### Scenario: The dictate control leaves the transcript

- **WHEN** a dictation is listening and the human presses the composer's dictate control to stop it
- **THEN** the session ends, the recognized text is left in the composer, and no message is submitted

#### Scenario: The off-page bar's Stop leaves the transcript

- **WHEN** a session ends from the off-page bar's Stop
- **THEN** the settled transcript is left in the target thread's composer and no message is submitted

#### Scenario: A held chord release sends when the setting is on

- **WHEN** auto-send is on, a push-to-talk chord is held past the hold threshold, and the human
  releases it with a transcript already recognized
- **THEN** the session ends and the settled transcript is submitted exactly once through the queued
  send path

#### Scenario: A toggle-off sends when the setting is on

- **WHEN** auto-send is on, a toggle session is listening with a transcript recognized, and the
  human presses the chord again to turn it off
- **THEN** the session ends and the settled transcript is submitted exactly once through the queued
  send path

#### Scenario: The keybinding leaves the transcript when the setting is off

- **WHEN** auto-send is off and the human ends a dictation with the keybinding, by a held release or
  by pressing a toggle session off
- **THEN** the session ends, the settled transcript is left in the composer, and no message is
  submitted

#### Scenario: A too-short, empty or failed transcript sends nothing even with the setting on

- **WHEN** auto-send is on and a keybinding-ended session settles to five words or fewer, to no
  words, or to a transcription error
- **THEN** nothing is submitted and the draft is left as the discard, empty or error rule requires

#### Scenario: Only an explicit send submits regardless of the setting

- **WHEN** a dictation is listening or transcribing and the human presses the send keybinding or the
  Send button, whether auto-send is on or off
- **THEN** the session finishes and the settled transcript is submitted exactly once, through the
  queued send path

#### Scenario: Escape still discards rather than leaving the transcript

- **WHEN** a dictation is listening or transcribing and the human presses Escape
- **THEN** the transcript is discarded, the draft is restored to its pre-dictation value, and
  nothing is submitted
