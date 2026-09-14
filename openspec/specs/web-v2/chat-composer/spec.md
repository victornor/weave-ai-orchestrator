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
