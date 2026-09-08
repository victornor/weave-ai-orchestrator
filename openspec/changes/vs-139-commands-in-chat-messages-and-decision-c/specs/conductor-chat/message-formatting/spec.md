## MODIFIED Requirements

### Requirement: A message is shown with the formatting it was written with

A message shown in the conductor chat SHALL be rendered from its body as markdown, with a single
newline inside a paragraph treated as a line break rather than as a space.

Consecutive blank lines between two paragraphs SHALL collapse into a single paragraph gap, so the
spacing of the conversation does not depend on how many times the author pressed Enter.

Lists, headings, block quotes and fenced code blocks SHALL be rendered as such, and the contents of a
fenced code block SHALL be shown verbatim, with its own line breaks and without markup being applied
inside it.

An inline code span SHALL also be shown verbatim: markdown syntax inside it (bold, italics, a link,
a document reference) SHALL NOT be interpreted, exactly as for a fenced code block.

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

#### Scenario: An inline code span containing markdown-special characters

- **WHEN** a message contains an inline code span whose text includes characters that would otherwise be interpreted as markdown, such as `**` or `[[`
- **THEN** the span is shown as the literal text, with no bold, italics, link or document reference applied inside it

## ADDED Requirements

### Requirement: Code in a message can be copied with one tap

A fenced code block and an inline code span rendered by this capability SHALL each offer a way to
copy the exact source text of that block or span to the clipboard in one tap, without requiring the
reader to select the text by hand.

What is copied SHALL be the raw source text — the same bytes the author typed between the fences or
the backticks — and SHALL NOT be the rendered or reflowed text: no smart quotes, no collapsed
whitespace, no HTML entities, and no trailing newline added or removed relative to the source.

Copying SHALL confirm visibly that it happened. Where the copy control cannot access the clipboard —
an insecure context, a browser that refuses, or a write that is rejected when attempted — the
control SHALL say that copying is not possible rather than appearing to do nothing.

Tapping an inline code span to copy it SHALL NOT interfere with selecting text: selecting a
paragraph that contains an inline code span SHALL still select the code span's text along with the
rest of the paragraph, and a tap that is actually part of scrolling or selecting SHALL NOT trigger a
copy.

#### Scenario: Copying a fenced code block

- **WHEN** the reader uses a fenced code block's copy control
- **THEN** the block's exact source text, including its own line breaks, is placed on the clipboard, byte for byte

#### Scenario: Copying an inline code span

- **WHEN** the reader taps an inline code span's copy control
- **THEN** the span's exact source text is placed on the clipboard, byte for byte

#### Scenario: Selecting a paragraph that contains inline code

- **WHEN** the reader selects a run of text that includes an inline code span
- **THEN** the selection includes the span's text, and nothing is copied to the clipboard as a side effect

#### Scenario: A tap that is part of scrolling

- **WHEN** the reader's finger moves across an inline code span while scrolling, without a distinct tap
- **THEN** nothing is copied to the clipboard

#### Scenario: Copying confirms

- **WHEN** the reader copies a code block or span
- **THEN** the control visibly shows that the copy happened

#### Scenario: The clipboard is unavailable

- **WHEN** the browser context offers no way to write to the clipboard
- **THEN** the copy control says it cannot copy rather than appearing to do nothing

#### Scenario: A copy attempt is refused

- **WHEN** the reader uses a copy control and the clipboard write is rejected
- **THEN** the control says the copy failed rather than silently doing nothing
