## ADDED Requirements

### Requirement: Ticket identifiers in a session's conversation are clickable

Every place a persistent session's ticketless conversation shows agent-authored text — the settled
turn transcript's prose and thinking, the live streaming turn, and a finished turn's delivered
final-text fallback — SHALL render a ticket identifier as a clickable tag. The surface SHALL NOT add
a second identifier pattern: the tag comes from the one shared linkifier the chat surfaces use, and
activating it SHALL go through the one shared ticket link handler the weaver and planning chats use.

On a desktop viewport, activating the tag SHALL open the ticket in a modal over the session chat,
with a small control that opens the full ticket page; on a phone viewport it SHALL navigate to the
ticket page as it does today. The modal SHALL show the ticket's live feed and SHALL reuse the same
ticket detail and live-feed components the ticket page uses, including the not-found state.

An identifier SHALL stay literal text when it appears inside an inline code span, a fenced code
block, an edit diff, a written-file preview or command output; those are rendered as verbatim
content, not as prose. An identifier whose ticket does not exist in the workspace SHALL show the
existing not-found state rather than a broken modal or page.

#### Scenario: An identifier in a settled transcript is a tag

- **WHEN** a finished session turn's transcript carries assistant prose naming a ticket identifier
- **THEN** that identifier renders as a clickable tag

#### Scenario: An identifier in the live streaming turn is a tag

- **WHEN** a session turn is live and its streamed partial text names a ticket identifier
- **THEN** the identifier renders as a clickable tag while the text is still streaming

#### Scenario: A delivered final text that is not in the recorded events is a tag

- **WHEN** a finished turn's transcript carries no assistant text and its delivered final text is
  shown as the turn's closing text
- **THEN** a ticket identifier in that text renders as a clickable tag

#### Scenario: On desktop the tag opens the ticket modal

- **WHEN** the human activates a session transcript's ticket tag on a desktop viewport
- **THEN** the ticket opens in a modal over the chat showing its live feed, with a control that opens
  the full ticket page

#### Scenario: On a phone the tag navigates to the ticket page

- **WHEN** the human activates a session transcript's ticket tag on a phone viewport
- **THEN** the ticket page opens, as before

#### Scenario: Code stays literal

- **WHEN** an identifier appears inside an inline code span or a fenced code block in session agent text
- **THEN** it renders exactly as written, as code, and is not a tag

#### Scenario: Diff, file preview and command output stay literal

- **WHEN** an identifier appears in an edit diff, a written-file preview or command output within a
  session turn
- **THEN** it is shown verbatim and is not a tag

#### Scenario: An unknown identifier shows not-found

- **WHEN** the human activates a tag whose ticket does not exist in the workspace
- **THEN** the modal (desktop) or the ticket page (phone) shows the existing "No ticket X in this
  workspace." state with a way out, rather than a broken or blank surface
