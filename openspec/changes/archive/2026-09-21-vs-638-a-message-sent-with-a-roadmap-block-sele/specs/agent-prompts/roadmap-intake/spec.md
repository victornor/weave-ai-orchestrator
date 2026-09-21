## ADDED Requirements

### Requirement: A selected roadmap block means the ask is a roadmap item

The `weave-ai-weaver` skill SHALL state, in no more than two lines, that when the turn was woken by a
human message whose payload carries a roadmap block the human selected in the composer, the ask is a
roadmap item in that block: it SHALL be added with `weave_roadmap_item_add` and SHALL NOT be filed as
its own ticket. The rule SHALL appear once, in the block-building guidance, and no duplicated prose
contradicting it SHALL remain.

#### Scenario: The rule is stated once and concisely

- **WHEN** the `weave-ai-weaver` skill is read
- **THEN** it states that a selected block means the ask is a roadmap item, in at most two lines, and
  the duplicated selected-block sentence is gone

#### Scenario: The rule names the tool

- **WHEN** the rule is read
- **THEN** it names `weave_roadmap_item_add` as the action for an ask sent with a block selected
