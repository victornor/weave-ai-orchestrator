# plan-artifacts/planner-surface Specification

## Purpose
Makes a planner-published artifact visible where the plan is discussed: as a card in the Plan tab's
planner conversation at the point it was published, opening in the same sandboxed viewer worker
artifacts use and staying attached to the plan across reloads, plan reopening and submission.

## Requirements

### Requirement: A published plan artifact appears in the plan conversation where it was published

When the planning agent publishes an artifact to its plan, the plan's conversation SHALL show a card
for it in the position the artifact was published, carrying the artifact's title and an open action.
Publishing SHALL NOT be a substitute for the planner's reply: the planning agent MUST still send its
answer through its own reply tool, and the card supplements that reply rather than replacing it.

#### Scenario: An artifact card appears at the publish point

- **WHEN** the planning agent publishes an artifact while the plan's tab is open
- **THEN** a card for that artifact appears in the plan conversation in the published position, with
  its title and an open action, without the page needing a manual reload

#### Scenario: The artifact does not replace the reply

- **WHEN** the planning agent publishes an artifact and then sends its answer through the planner's
  reply tool
- **THEN** the answer still reaches the conversation as the planner's reply, and the artifact card is
  additional to it

#### Scenario: Republishing a key updates rather than duplicates the card

- **WHEN** the planning agent publishes a new revision under a key whose card is already in the plan
  conversation
- **THEN** no second card is added for that key; the existing card reflects the new revision at the
  point it was originally published

### Requirement: The card opens the artifact in the same sandboxed viewer worker artifacts use

The artifact card's open action SHALL render the artifact through the same sandboxed viewer component
that already renders a ticket- or workspace-scoped artifact, fed the plan artifact's raw serving URL,
and SHALL never render an unsandboxed frame or an artifact body obtained by any other path.

#### Scenario: Opening a plan artifact card

- **WHEN** a human activates the open action on a plan artifact card
- **THEN** the artifact renders inside the shared sandboxed viewer, using the plan artifact's raw
  serving URL

### Requirement: The artifact and its card stay attached to the plan

A plan artifact, and the card that represents it in the plan conversation, SHALL be persisted with the
plan — not held only in the open page — so that they remain after a reload, after the plan's tab is
left and reopened, and after the plan's planner is retired and ensured again. The viewer URL the
publishing tool returns SHALL remain valid after the plan is submitted or discarded, so a link placed
in a draft description continues to resolve from the ticket created from that draft.

#### Scenario: The card survives a reload and a planner replacement

- **WHEN** an artifact has been published to a plan, the page is reloaded, and later the plan's
  planner is retired and a new planner is ensured
- **THEN** the artifact card is still shown in the plan conversation at its publish point and still
  opens the artifact

#### Scenario: A link from a submitted plan's ticket still resolves

- **WHEN** a draft description carries a published plan artifact's viewer URL, and the plan is
  submitted so a real ticket is created from that draft
- **THEN** opening that URL after submission still renders the artifact
