## MODIFIED Requirements

### Requirement: Assistant text streams into the chat while the turn runs

While a conductor turn is running, the chat SHALL render the assistant text the conductor produces as each piece of it arrives, not only when the turn completes. Consecutive pieces of assistant text SHALL read as continuous prose rather than as separate messages.

A text block, including a thinking/narration block, SHALL render with the same markdown formatting rules a finished message's body uses — bold, italic, inline code, fenced code blocks, and ordered and unordered lists — rather than as literal, unformatted text. This SHALL hold on every surface that renders a running turn's transcript through the shared live-transcript component, not only the conductor chat: the worker page and, through it, the ticket and run pages.

A block whose text is only partially streamed — an opening `**` with no closing pair yet, a fenced code block not yet closed, a list item still being written — SHALL render without error, showing its content as plainly as the incomplete markup allows, and SHALL render with correct formatting once the rest of the block arrives, with no leftover artifact from the partial state.

Markdown rendering of trace text SHALL follow the same safety rules a finished message's markdown follows, with no raw HTML from the block's text executed as markup, since trace text originates from the agent and is untrusted in the same way a finished message's body is.

#### Scenario: Text arrives during the turn

- **WHEN** the conductor produces a block of assistant text partway through a turn
- **THEN** that text appears in the chat's live region before the turn finishes

#### Scenario: Successive text blocks

- **WHEN** the conductor produces several assistant text blocks in the same turn with no tool call between them
- **THEN** they render as one continuous passage, not as repeated separate entries

#### Scenario: A live block renders markdown like a finished message

- **WHEN** a block of live assistant or thinking text contains bold markers, an inline code span, or a numbered list
- **THEN** it renders formatted — bold, a code span, a list — the same way that text would render once the message is finished, rather than showing the literal markup characters

#### Scenario: A partially streamed block does not break

- **WHEN** a live text block's markdown is incomplete — an unclosed `**`, an unfinished list item, an unclosed fenced code block
- **THEN** the block renders without error, and once the rest of the block arrives it renders with correct formatting and no leftover artifact from the partial state

#### Scenario: Untrusted trace text cannot inject markup

- **WHEN** a live text block's content contains raw HTML-like text
- **THEN** it renders as inert text, not as executed markup, the same way it would in a finished message

#### Scenario: The same rendering holds on the worker and ticket surfaces

- **WHEN** a running turn's transcript is shown on the worker page or, through the shared live-transcript component, on a ticket or run page
- **THEN** its text blocks render with the same markdown formatting and the same partial-markup safety as the conductor chat's live view

### Requirement: A reload mid-turn resumes the live view

When a chat surface loads while a conductor turn is already running, it SHALL show that turn's activity so far and continue receiving the rest of it, rather than showing an empty live region. When the connection to the live stream drops and is re-established, the surface SHALL resume from where it stopped without re-rendering activity it already showed and without silently losing activity that occurred while it was disconnected.

Activity already shown SHALL NOT be rendered again while the surface remains connected, including when the surface independently re-fetches the turn's persisted history — for example because another notification on the same connection invalidated it — while that same activity is also present in what the live stream has already delivered. The surface SHALL identify one piece of activity as the same piece of activity across its persisted and live representations by a value the two representations are guaranteed to agree on, not by a value that may legitimately differ between them.

While the live stream is not connected, the chat SHALL show that where the streaming output
itself is — not only in the app-level connection banner — using the run stream's connection
state (`live-streams/connection-state`), distinguishing the device being offline from the server
being unreachable, and SHALL offer a manual retry. The notice SHALL disappear on its own once the
stream reconnects, without a reload, and SHALL NOT cover the composer or the phone bottom bar.

#### Scenario: Page reloaded mid-turn

- **WHEN** the human reloads the chat while a conductor turn is running
- **THEN** the chat shows the activity that turn has already produced and keeps appending new activity as it arrives

#### Scenario: Stream reconnects

- **WHEN** the live stream drops and reconnects during a turn
- **THEN** activity produced while disconnected is shown, and activity already shown is not duplicated

#### Scenario: A persisted refetch overlaps the live tail

- **WHEN** the turn's persisted history is re-fetched while the connection is up and some of that history has already been delivered by the live stream
- **THEN** the overlapping activity renders exactly once, not once from each source

#### Scenario: No turn running

- **WHEN** the chat loads and the conductor is idle
- **THEN** no live region and no working indicator are shown, and the thread renders as before

#### Scenario: The live stream drops mid-turn

- **WHEN** the run event stream's connection is lost while a turn is being shown
- **THEN** the chat shows, next to the working indicator, that the live stream is reconnecting or
  offline and offers a manual retry, without waiting for the app-level banner alone to say so

#### Scenario: The live stream recovers

- **WHEN** the run event stream reconnects after having been shown as dropped
- **THEN** the notice disappears on its own, with no duplicated or missing activity and no reload

#### Scenario: The notice on a phone

- **WHEN** the run stream's connection notice is shown on the phone layout
- **THEN** it does not overlap or push away the composer or the bottom tab bar
