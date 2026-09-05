# conductor-chat/message-formatting Specification

## Purpose
Defines how the text a human or an agent wrote is shown back in a conversation — the conductor chat's
thread and a ticket's comments — so that the line breaks, paragraphs, lists and code the author typed
are the ones the reader sees, and so that both sides of a conversation are rendered the same way.

## Requirements

### Requirement: A message is shown with the formatting it was written with

A message shown in the conductor chat SHALL be rendered from its body as markdown, with a single
newline inside a paragraph treated as a line break rather than as a space.

Consecutive blank lines between two paragraphs SHALL collapse into a single paragraph gap, so the
spacing of the conversation does not depend on how many times the author pressed Enter.

Lists, headings, block quotes and fenced code blocks SHALL be rendered as such, and the contents of a
fenced code block SHALL be shown verbatim, with its own line breaks and without markup being applied
inside it.

#### Scenario: A message written on several lines

- **WHEN** a message whose body is two lines separated by a single newline is shown
- **THEN** the two lines are shown on separate lines

#### Scenario: Paragraphs separated by blank lines

- **WHEN** a message whose body has two paragraphs separated by two or more blank lines is shown
- **THEN** the two paragraphs are shown with one paragraph gap between them

#### Scenario: A message containing a list

- **WHEN** a message whose body contains a markdown list is shown
- **THEN** it is shown as a list, with one item per line of the list

#### Scenario: A message containing a code fence

- **WHEN** a message whose body contains a fenced code block is shown
- **THEN** the fenced content is shown as a code block, keeping its own line breaks, and markdown inside it is not interpreted

### Requirement: Both sides of a conversation are rendered the same way

The message a human sent and the message an agent sent SHALL be rendered through the same path, so a
thread reads consistently regardless of who wrote each message. Anything the rendering of an agent
message offers on top of the text — such as making a ticket identifier openable — SHALL be offered on
a human message on the same terms.

#### Scenario: A human message and an agent message with the same body

- **WHEN** a human message and an agent message with identical bodies are shown in the same thread
- **THEN** both are rendered with the same structure, differing only in the styling that marks who wrote them

#### Scenario: A ticket identifier in a human message

- **WHEN** a human message naming a ticket by its identifier is shown
- **THEN** that identifier is openable exactly as it is in an agent message

### Requirement: Ticket comments are rendered like conversation messages

A comment on a ticket SHALL be rendered with the same markdown-and-line-breaks treatment as a message
in the conductor chat, whoever wrote it, because a comment is composer text in the same sense.

Text that is not composer text — a ticket's description, a plan or proposal document, a worker brief,
a role charter, a knowledge file — SHALL keep being rendered without that treatment, so a hard-wrapped
document still reflows into paragraphs rather than breaking at every wrapped line.

#### Scenario: A multi-line ticket comment

- **WHEN** a comment whose body has several lines separated by single newlines is shown on a ticket
- **THEN** those lines are shown on separate lines

#### Scenario: A hard-wrapped document

- **WHEN** a knowledge file, a plan document, a worker brief or a ticket description whose paragraphs are hard-wrapped is shown
- **THEN** each paragraph reflows as one paragraph, exactly as it did before this capability existed

### Requirement: Quoting a message stays a compact reference

The quote that identifies which message is being replied to — beside the composer while writing, and
above a sent message afterwards — SHALL remain a short clamped excerpt rather than a rendering of the
quoted message's formatting, so it stays a locator and never competes with the message itself.

#### Scenario: Replying to a message that spans several lines

- **WHEN** the human replies to a message whose body spans several lines
- **THEN** the quote beside the composer is a short clamped excerpt, not a multi-line rendering of that message

#### Scenario: A sent reply to a multi-line message

- **WHEN** a sent message that replied to a multi-line message is shown
- **THEN** the quote above it is a short clamped excerpt, and the sent message's own body is rendered with its formatting

### Requirement: Rendering does not change what is stored

The body stored for a message or a comment SHALL be exactly the text that was submitted, including its
newlines, and reading it back SHALL return it unchanged. The treatment described by this capability is
display only: nothing normalises, rewraps or strips the stored text.

#### Scenario: Round-tripping a multi-line body

- **WHEN** a message whose body contains single newlines, blank lines and a fenced code block is sent to a thread and the thread's messages are then read
- **THEN** the body read back is byte-for-byte the body that was sent

#### Scenario: A multi-line message that lands as a ticket comment

- **WHEN** a multi-line message is sent to a thread bound to a ticket
- **THEN** the comment recorded on that ticket carries the same body, unchanged
