## ADDED Requirements

### Requirement: A merge-approval card links to a conversation with the worker that asked it

A `merge_approval` decision card SHALL offer a way to open a conversation with the worker that asked
it, alongside its existing approve and hold actions, so the human can ask about the work before
answering rather than only after.

#### Scenario: The link is offered on a merge-approval card

- **WHEN** a `merge_approval` decision card is shown to the human
- **THEN** it offers a way to open a conversation with the worker that asked it

#### Scenario: Other decision kinds are unaffected

- **WHEN** a decision card of a kind other than `merge_approval` is shown to the human
- **THEN** it offers no such link
