## MODIFIED Requirements

### Requirement: Inline references and attachments render per kind

Ticket identifiers in a message body SHALL render as clickable bordered mono tags that open the
ticket; other literals SHALL stay code spans; page links SHALL read as underlined prose links. The
tag SHALL be produced by one shared linkifier used by every agent-text surface in the web app,
including the weaver chat, the planning chat and a persistent session's transcript, live streaming
text and trace narration; no surface SHALL add its own identifier pattern. An identifier that
appears inside an inline code span or a fenced code block SHALL stay literal code, exactly as
written, and SHALL NOT become a tag. A message's attachments SHALL render as rows beneath its body,
each with a glyph, its byline and its kind, with an image shown as a preview and a file linked for
download.

#### Scenario: A ticket reference is a tag

- **WHEN** a message body names a ticket identifier
- **THEN** it renders as a bordered mono tag that opens that ticket when clicked

#### Scenario: Literals and page links

- **WHEN** a message body contains an inline code literal and a link to a page
- **THEN** the literal stays a code span and the page link reads as underlined text

#### Scenario: An identifier inside a code span stays literal

- **WHEN** a message body contains a ticket identifier inside an inline code span or a fenced code block
- **THEN** it is rendered as the literal text that was written, as code, and is not a tag

#### Scenario: The tag comes from one shared linkifier

- **WHEN** agent text naming a ticket identifier is rendered on any agent-text surface, including the live stream and the trace
- **THEN** the tag is produced by the same shared linkifier the message body uses, not a surface-local pattern

#### Scenario: Attachment rows

- **WHEN** a message carries attachments
- **THEN** each renders as a row under the body with its glyph, byline and kind

## ADDED Requirements

### Requirement: A ticket reference opens a modal over the chat on desktop

Activating a ticket reference in a chat SHALL go through one shared link handler used by the weaver
chat, the planning chat and a persistent session's chat, so all three inherit the same behaviour and
none builds its own navigation.

On a desktop viewport the handler SHALL open the ticket in a modal over the chat instead of
navigating away. The modal SHALL show the ticket's live feed — reusing the ticket detail and the
live-feed components the ticket page uses, not a second view — and SHALL carry a small control at
the top that opens the full ticket page. The modal SHALL be dismissible by Escape, its close control
and its backdrop; closing it SHALL leave the chat's scroll position and any composer draft intact,
because the chat is never unmounted. Where the ticket identifier does not exist in the workspace,
the modal SHALL show the existing not-found state rather than a broken modal. On a phone viewport
the handler SHALL navigate to the ticket page, as before. The one surface that SHALL keep direct
navigation is the ticket page's own feed, where a modal over the ticket already shown would be
redundant.

#### Scenario: A click opens the modal instead of navigating

- **WHEN** the human clicks a ticket tag in the weaver, planning or session chat on a desktop viewport
- **THEN** a modal opens over the chat showing that ticket, and the chat is not navigated away from

#### Scenario: The modal shows the live feed

- **WHEN** the modal is open on a ticket with a running worker
- **THEN** it shows the ticket's live activity and its turn feed through the ticket page's own feed components

#### Scenario: The modal follows the app's theme

- **WHEN** the app is in light theme and the modal is open
- **THEN** the modal panel, its text and its backdrop render in the light token set, because a portalled dialog mirrors the active theme rather than falling back to the document default

#### Scenario: The top control opens the full ticket page

- **WHEN** the human activates the modal's control at the top
- **THEN** the full ticket page opens

#### Scenario: Escape, the close control and the backdrop close it

- **WHEN** the modal is open and the human presses Escape, clicks its close control, or clicks the backdrop
- **THEN** the modal closes and the chat behind it is unchanged, with its scroll position and draft intact

#### Scenario: An unknown identifier shows not-found in the modal

- **WHEN** the human clicks a tag whose ticket does not exist in the workspace
- **THEN** the modal shows the existing "No ticket X in this workspace." state with a way out, not a broken modal

#### Scenario: Phone keeps navigating to the ticket page

- **WHEN** the human clicks a ticket tag on a phone viewport
- **THEN** the ticket page opens, as before

#### Scenario: The chats share one handler

- **WHEN** the weaver, planning and session chats each render ticket references
- **THEN** each activates them through the same shared link handler, so the modal-vs-navigation choice cannot diverge between them
