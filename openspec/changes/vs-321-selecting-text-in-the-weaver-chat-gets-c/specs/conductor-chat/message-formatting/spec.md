## ADDED Requirements

### Requirement: Rendering an unchanged message does not disturb its DOM

Re-rendering a message, ticket comment, plan preview or decision card whose rendered content has not
changed SHALL NOT replace the DOM nodes that content produced. A reader's text selection made inside
one of these, and the browser's native find-in-page match state, SHALL survive an unrelated update
elsewhere in the conversation — a new message arriving, a live trace event streaming in, a decision
card appearing, or the underlying data refetching with the same content.

This holds regardless of what caused the re-render: the requirement is about the rendered output
being stable when its inputs are unchanged, not about suppressing any particular kind of update.

#### Scenario: Selecting an older message while a new one arrives

- **WHEN** the reader selects text inside an earlier message in the conductor chat, and a new
  message, a live trace event, or a decisions refetch then arrives while they are still scrolled
  away from the bottom
- **THEN** the selection remains intact and can still be copied

#### Scenario: A message refetch with identical content

- **WHEN** the messages behind the conversation are refetched and return the same content as before
- **THEN** the DOM nodes for a message whose content did not change are not replaced

#### Scenario: Scroll-follow is unaffected

- **WHEN** the reader is at the bottom of the conductor chat and new content arrives
- **THEN** the list still follows the newest message, exactly as it did before this requirement
