## ADDED Requirements

### Requirement: A thread message is one bounded bubble

Each stored conductor-chat thread message SHALL render as exactly one visual
message container (a bubble). Human (inbound) and conductor (outbound)
messages SHALL both have such a container. Who wrote the message MAY change
alignment, width and colours; it SHALL NOT drop the container.

One `ac_human_send` SHALL produce one stored thread message and therefore one
bubble. The daemon SHALL NOT split a message body across several stored
messages.

Consecutive outbound messages from the same turn that were sent as separate
`ac_human_send` calls SHALL remain separate bubbles. This requirement does
not merge them.

#### Scenario: A long conductor reply is one bubble

- **WHEN** a conductor-chat thread contains one outbound message whose body is a long markdown reply that includes a fenced code block
- **THEN** that body is shown as exactly one message container, and the fenced block is inside that container

#### Scenario: Human and conductor messages both have a container

- **WHEN** a human message and a conductor message are shown in the same thread
- **THEN** each is inside its own message container

#### Scenario: One send is one stored message

- **WHEN** the conductor delivers a reply with a single `ac_human_send` whose body is long markdown
- **THEN** the thread stores one message with that body, not several

### Requirement: Formatted content stays inside the bubble

Markdown rendered for a conductor-chat thread message — paragraphs, lists,
headings, fenced code, inline code, and tables — SHALL be laid out inside
that message's container. None of it SHALL paint into the thread chrome
outside the container.

A fenced code block whose lines are wider than the bubble SHALL scroll
horizontally inside the bubble rather than widening the thread. An unclosed
opening fence at the end of the body SHALL still render as a code block
inside the same bubble; it SHALL NOT swallow later messages or chrome.

#### Scenario: A long fenced block stays inside its bubble

- **WHEN** a thread message whose body contains a fenced block with lines wider than the message column is shown
- **THEN** the fenced content is inside that message's container, and the container does not grow past the column

#### Scenario: An unclosed fence does not escape the bubble

- **WHEN** a thread message whose body opens a fenced code block and never closes it is shown
- **THEN** the fenced content is shown as a code block inside that message's container, and later messages in the thread remain separate containers

### Requirement: GFM tables in chat render inside the bubble

A GitHub-flavoured markdown pipe table in a conductor-chat message body SHALL
be shown as a table inside that message's container. The table SHALL NOT
appear as raw pipe characters in the thread chrome, and a table wider than
the bubble SHALL scroll horizontally inside the bubble.

The stored body SHALL remain the markdown that was submitted. This treatment
is display only.

Ticket comments MAY pick up the same table rendering because they share the
markdown path; Telegram and the TUI are out of scope.

#### Scenario: A pipe table in a conductor reply

- **WHEN** a conductor-chat message whose body contains a GFM pipe table is shown
- **THEN** the table is shown as a table inside that message's container, not as raw pipes outside it

#### Scenario: A wide table stays inside the bubble

- **WHEN** a thread message whose body contains a GFM pipe table wider than the message column is shown
- **THEN** the table is inside that message's container and scrolls horizontally rather than widening the thread
