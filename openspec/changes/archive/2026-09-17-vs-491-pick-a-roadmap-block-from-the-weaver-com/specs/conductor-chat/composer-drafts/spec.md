## ADDED Requirements

### Requirement: The chosen roadmap block is kept with the draft

In the conductor chat, the roadmap block chosen beside the input SHALL be kept with the draft it was
chosen for, alongside the text, the reply reference and the project, and SHALL be restored with it.
A *confirmed* send SHALL clear the chosen block together with the project; a send that fails SHALL
leave it exactly as it was, alongside the retained text.

#### Scenario: Coming back to a drafted message with a block chosen

- **WHEN** the human chooses a project, chooses one of that project's blocks, types a message, leaves
  the page and returns
- **THEN** the block is shown as chosen alongside the project, and sending carries both

#### Scenario: A failed send keeps the chosen block

- **WHEN** the human sends a message scoped to a project and a block, and the send fails
- **THEN** the block and the project are still shown on the composer afterwards

#### Scenario: A confirmed send clears the chosen block

- **WHEN** the human sends a message with a block chosen and the send is confirmed
- **THEN** the block choice is cleared, and reloading the chat does not restore it
