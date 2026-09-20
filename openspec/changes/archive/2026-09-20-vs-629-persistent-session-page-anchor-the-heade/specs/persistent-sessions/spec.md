## MODIFIED Requirements

### Requirement: A session's conversation shows each turn's transcript

A persistent session's conversation surface SHALL render the conversation as the raw session, not as a list of delivered answers. For each turn it SHALL show, in order, the human message that woke it and then that turn's transcript: the assistant text as it was written, each tool call and its result, `edit`/`write` as diffs, file previews and command rows with their output, with the transcript renderer's syntax highlighting. The transcript SHALL render live while the turn runs and SHALL be unchanged after it ends.

The conversation surface SHALL fill the frame between a pinned header and a pinned composer. Its transcript region SHALL be the only scrolling region: the document itself SHALL NOT scroll, the header and composer SHALL remain visible while the transcript scrolls, and no turn SHALL nest a second scrolling region inside the conversation.

A turn's final text SHALL be shown exactly once: the transcript is where it appears, and the delivered copy of that final text SHALL NOT be rendered a second time as its own message. A runtime whose final text is not among the turn's recorded events SHALL still have that text shown as part of the turn, so an answer is never lost.

A system notice SHALL still render as a notice, centred and attributed to the system, not as a message from either party.

#### Scenario: Several turns, each with its transcript

- **WHEN** a ticketless persistent session's conversation has had more than one human-woken turn
- **THEN** the surface shows each human message followed by that turn's transcript, in the order they happened

#### Scenario: A turn's tools, diff and file render between two messages

- **WHEN** a session turn between two human messages called a tool, edited a file and wrote another
- **THEN** the surface shows that turn's tool rows, the edit's diff, the written file's preview and any command output between the two human messages, syntax-highlighted

#### Scenario: Live, then unchanged

- **WHEN** a session's turn runs and then ends
- **THEN** its transcript streams while the turn runs and reads the same after it ends, the transcript region is the only scrolling region in the surface, and no turn nests a scrolling region of its own

#### Scenario: The header and composer stay while the transcript scrolls

- **WHEN** a session's conversation is longer than the viewport and the human scrolls its transcript
- **THEN** the transcript content moves under a header that stays at the top and a composer that stays at the bottom, and the document itself does not scroll

#### Scenario: The final text is shown once

- **WHEN** a turn's final text is delivered to the thread
- **THEN** the words appear once, in the turn's transcript, and not again as a separate message

#### Scenario: An answer not in the recorded events is still shown

- **WHEN** a finished turn's transcript carries no assistant text but the turn delivered a final answer to the thread
- **THEN** that answer is shown as part of the turn, once

#### Scenario: A failed turn still names its cause

- **WHEN** a session turn ends failed, timed out or cancelled
- **THEN** the conversation shows the turn's transcript and the system notice naming the plain reason

## ADDED Requirements

### Requirement: A session's conversation follows the newest turn until the reader scrolls up

A persistent session's conversation surface SHALL follow the newest content while the reader is at the bottom of the transcript: a turn that streams, or an answer that arrives, SHALL stay in view without the human scrolling. When the reader scrolls up, the follow SHALL pause so their reading position is not yanked away, and new content arriving while paused SHALL be marked rather than scrolled to. A jump-to-latest control SHALL be offered while the follow is paused; activating it, or the reader scrolling back to the bottom, SHALL resume following. The follow SHALL measure the transcript element itself, not the document, and SHALL re-pin when the visible area shrinks without the content changing — including while the on-screen keyboard is open.

#### Scenario: A streaming turn stays in view

- **WHEN** a session turn streams new output while the human is at the bottom of the transcript
- **THEN** the transcript follows the newest output and the newest line stays visible

#### Scenario: Scrolling up pauses the follow

- **WHEN** the human scrolls the transcript up to read earlier output while a turn is streaming
- **THEN** the transcript stops following, their reading position stays put as new output arrives, and a jump-to-latest control appears

#### Scenario: Returning to the bottom resumes following

- **WHEN** the human activates the jump-to-latest control, or scrolls back to the bottom themselves
- **THEN** the transcript returns to its newest line and follows new content again

#### Scenario: The follow measures the transcript, not the page

- **WHEN** the conversation is taller than the viewport and the document does not scroll
- **THEN** the follow and the pause are decided by the transcript element's own scroll position, and no document-level scroll position is read

#### Scenario: A shrinking visible area re-pins while following

- **WHEN** the on-screen keyboard opens, shrinking the visible area, while the transcript is following
- **THEN** the transcript re-pins to its newest line so the composer and the newest output stay visible