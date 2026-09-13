# conductor-chat/live-turn-stream Specification

## Purpose
Defines what a conductor chat surface shows while a conductor turn is running: that the conductor is working, the text it produces as it produces it, and each tool call it makes — so the human can see progress instead of a static screen, and so the live view survives a reload without duplicating the final reply.

## Requirements

### Requirement: The conductor's current run is discoverable in one request

A chat surface SHALL be able to learn the conductor's identity and its most recent run from a single request to the conductor endpoint. The endpoint SHALL return a detail envelope carrying the conductor agent and its latest run (or `null` when the conductor has never run), rather than a bare agent record.

The run's status distinguishes a turn in progress from a finished one, so the surface can decide whether to open a live view without polling.

#### Scenario: Conductor with a run in progress

- **WHEN** a client requests the conductor detail while a conductor turn is executing
- **THEN** the response carries the conductor agent and the in-progress run, including that run's id and its running status

#### Scenario: Conductor that has never run

- **WHEN** a client requests the conductor detail before the conductor has taken a turn
- **THEN** the response carries the conductor agent and a null last run, and the request succeeds

#### Scenario: Existing clients keep working

- **WHEN** a first-party client that reads the conductor agent from the response consumes the detail envelope
- **THEN** it resolves the same agent it resolved before this change

### Requirement: The chat shows that the conductor is working

A conductor chat surface SHALL display an explicit working indicator for the whole time a conductor turn is running, and SHALL remove it when the turn ends. The indicator SHALL be driven by the run's lifecycle rather than only by the act of sending a message, so it is also shown for a turn the human did not start (a wake from a worker, a decision, or a schedule).

The indicator SHALL appear within a second or two of the human sending a message, without waiting for the conductor's first output.

#### Scenario: Sending a message

- **WHEN** the human sends a message to the conductor
- **THEN** the chat shows the working indicator immediately, and keeps showing it until the conductor's turn finishes

#### Scenario: A turn the human did not start

- **WHEN** a conductor turn starts from a wake that was not a human message
- **THEN** the chat shows the working indicator for that turn

#### Scenario: Turn ends

- **WHEN** the conductor's run reaches a terminal state, whether it succeeded, failed or was cancelled
- **THEN** the chat removes the working indicator

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

### Requirement: Each tool call appears as a compact, secondary block

While a conductor turn is running, the chat SHALL render every tool call the conductor makes, as it happens, as its own block showing the tool's name and a compact summary of its arguments. When the tool's result arrives, that result SHALL be folded into the same block — never rendered as a second, unrelated block — and the block SHALL indicate whether the call succeeded, failed or was denied.

The result's detail SHALL be available but not expanded by default, and tool blocks SHALL be visually secondary to the assistant text.

#### Scenario: A tool call begins

- **WHEN** the conductor invokes a tool
- **THEN** a block appears showing that tool's name and a compact summary of its arguments, marked as still running

#### Scenario: The tool's result arrives

- **WHEN** the result for a tool call arrives
- **THEN** the block for that call is updated in place with the outcome and its result detail, and no additional block is created for the result

#### Scenario: A tool call fails or is denied

- **WHEN** a tool call returns an error or is denied
- **THEN** its block is marked as failed or denied rather than successful

#### Scenario: Detail stays collapsed

- **WHEN** a tool block carries result detail
- **THEN** the detail is collapsed by default and can be expanded, so the assistant text remains the primary content

#### Scenario: Result without a matching call

- **WHEN** a tool result arrives whose originating call is not present in the events the surface holds
- **THEN** the result is still shown as its own block rather than discarded

### Requirement: The final reply is shown exactly once

The conductor's reply to the human is the outbound thread message it sends; that message is the durable record and SHALL remain the only place the reply text is shown once the turn is over. The live transcript SHALL NOT render the tool activity that delivers a reply to the human, so the reply never appears twice.

When the run finishes, the live transcript SHALL be replaced by that turn's trace section, collapsed — not by nothing. The replacement SHALL be continuous: the live block SHALL stay on screen until the row that takes its place is rendered, so the list does not lose and regain content while the thread reloads.

#### Scenario: Reply delivered mid-turn

- **WHEN** the conductor sends the human a message and then keeps working
- **THEN** the message appears once in the thread, and the tool activity that sent it does not appear in the live transcript

#### Scenario: Turn finishes

- **WHEN** the conductor's run finishes
- **THEN** the live transcript gives way to that turn's collapsed trace section, the reply text is shown only as the thread message, and the chat never shows a gap where the turn was

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

### Requirement: The behavior holds on both human-facing chat surfaces

The working indicator, the streamed assistant text, the per-tool-call blocks, the single final reply and the mid-turn resumption SHALL apply to the web conductor chat and to the terminal conductor chat alike. The two surfaces MAY differ in presentation, but SHALL NOT differ in which activity they show.

A message the human sends, or a decision they answer from the chat, that cannot reach the daemon
SHALL never be silently dropped: it SHALL be queued for delivery on reconnect when the failure is
that the daemon cannot be reached, the same offline queue the composer already uses for a message
sent while the device itself is offline, or the human SHALL be told plainly that it was not sent.
A pending send SHALL NOT leave the working indicator showing indefinitely when it was never
delivered.

#### Scenario: Terminal chat during a turn

- **WHEN** a conductor turn runs while the terminal chat is open
- **THEN** the terminal chat shows the working state, the streamed assistant text and the tool-call blocks for that turn

#### Scenario: Reply suppression is consistent

- **WHEN** the conductor delivers a reply to the human during a turn
- **THEN** both surfaces omit that delivery from the live transcript, applying the same rule

#### Scenario: A message send fails because the daemon is unreachable

- **WHEN** the human sends a chat message while the device reports itself online but the request
  to the daemon fails to reach it
- **THEN** the message is queued for delivery on reconnect rather than discarded, and the working
  indicator is cleared rather than left showing forever

#### Scenario: Answering a decision from chat while disconnected

- **WHEN** the human answers a non-secret decision card shown inline in the chat while the chat
  cannot reach the daemon
- **THEN** the answer is queued for delivery on reconnect, the same way it would be from the Needs
  You list

### Requirement: The in-flight send label ends when the send settles

The composer’s in-flight send label (“Sending…”, or the attachment wording) SHALL last only while the send request is in flight, as `conductor-chat/composer-send-lifecycle` defines. The chat’s working indicator — that the conductor is taking a turn — is a separate display. A successful send SHALL NOT keep the in-flight send label up until `run.finished`.

The working indicator MAY still appear as soon as the human sends, and stay until the turn finishes, including when live streams are down, so long as it is not the send-in-flight wording.

#### Scenario: POST succeeded, stream has not delivered run.finished

- **WHEN** the human’s send request completes successfully and no `run.finished` event has arrived
- **THEN** the composer is no longer showing the in-flight send label, and the chat may still show that the conductor is working

#### Scenario: POST succeeded, stream is not connected

- **WHEN** the human’s send request completes successfully while the workspace live stream is not connected
- **THEN** the composer is no longer showing the in-flight send label
