# planning-sessions/storage — delta

## MODIFIED Requirements

### Requirement: A draft plan persists across the modal closing and reopening

The system SHALL persist a plan's conversation and its draft list independently of whether the weaver
chat is open and independently of which of the project's plan tabs is focused. Switching tabs,
leaving the chat, and opening it again on another device SHALL NOT discard or alter any plan.

#### Scenario: Reopening after closing shows the same state

- **WHEN** captain leaves the chat with a `drafting` plan containing drafts, then returns to it later
- **THEN** the same conversation history and the same drafts, in the same order, are shown for that
  plan

#### Scenario: Switching between two plans leaves each unchanged

- **WHEN** captain has two `drafting` plans, edits a draft in the first, switches to the second, and
  switches back
- **THEN** the first plan still shows the edited draft and its own conversation, and the second
  plan's conversation and drafts are unchanged by the visit

#### Scenario: Another device shows the same plans

- **WHEN** captain opens the chat for a project on a second device
- **THEN** the same drafting plans are listed as tabs and each shows the same conversation history
  and drafts as on the first device
