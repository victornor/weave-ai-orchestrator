## ADDED Requirements

### Requirement: Each draft card is collapsed to a title and summary by default

Each draft card in the Plan tab's list SHALL be collapsed by default to a title and a short summary,
together with the compact facts already shown on the card — its kind, priority, target role,
dependencies, effective tier and status. Expanding the card SHALL reveal the draft's full description.
Collapsing SHALL NOT discard or alter the full description; the summary is additional to it.

#### Scenario: A freshly loaded plan shows collapsed cards

- **WHEN** captain opens a plan tab whose draft list has one or more drafts
- **THEN** every draft card is collapsed, showing its title and short summary plus its compact facts,
  and none shows the full description

#### Scenario: Expanding one card reveals its full description

- **WHEN** captain expands a collapsed draft card
- **THEN** that card shows the draft's full description while the other cards remain collapsed

#### Scenario: The full description is preserved

- **WHEN** a draft with a long description is collapsed and expanded again
- **THEN** the full description is shown unchanged

### Requirement: Draft cards can be expanded and collapsed individually and all at once

The Plan tab SHALL provide per-card expand and collapse controls and list-level **expand all** and
**collapse all** controls. A card's control SHALL be operable by keyboard and SHALL expose its
expanded or collapsed state to assistive technology. The existing per-draft edit, reorder and delete
controls SHALL remain available while the card is collapsed.

#### Scenario: Expand all and collapse all

- **WHEN** captain activates expand all on a list with several drafts, then collapse all
- **THEN** every card expands in one action, and every card collapses again in one action

#### Scenario: Editing, reorder and delete work on a collapsed card

- **WHEN** captain edits, reorders or deletes a draft while its card is collapsed
- **THEN** the action applies to that draft exactly as it does on an expanded card

### Requirement: A card's expanded state survives the plan refreshing under it

When the draft list refreshes — because the planner added or edited a draft, or captain changed one —
each card's expanded or collapsed state SHALL be preserved, keyed to the draft rather than to its
position or the fresh data. A card that was expanded SHALL stay expanded across the refresh.

#### Scenario: An expanded card stays expanded after the planner's edit

- **WHEN** captain has expanded a draft card and the drafting conversation then updates that draft
- **THEN** the card is still expanded after the refresh, showing the updated description

#### Scenario: A collapsed card does not open on its own

- **WHEN** captain has all cards collapsed and the planning agent adds a new draft
- **THEN** the existing cards stay collapsed and the new draft's card is also collapsed

### Requirement: The draft list shows how many drafts the plan has

The Plan tab's draft list SHALL show the number of drafts in the plan, so an overview is available
without counting cards on screen.

#### Scenario: The count reflects the plan

- **WHEN** captain views a plan with six drafts
- **THEN** the draft list shows that it contains six drafts

#### Scenario: The count updates with the list

- **WHEN** a draft is added to or removed from the plan
- **THEN** the displayed count changes to match the new number of drafts
