## ADDED Requirements

### Requirement: The planning surface never widens to fit a child

The planning surface SHALL constrain the width of its conversation pane so that no child — the
dictation meter or any other — can widen the pane or the surface beyond the surface's own laid-out
size. A child that cannot fit SHALL be clipped or scrolled inside the pane, not allowed to grow it.

#### Scenario: Listening does not widen the pane

- **WHEN** captain starts dictation in the planning surface's composer
- **THEN** the conversation pane and the planning surface keep the widths they had before dictation
  started

#### Scenario: The pane is width-constrained

- **WHEN** the conversation pane contains a child wider than the pane
- **THEN** the child is contained by the pane rather than expanding it
