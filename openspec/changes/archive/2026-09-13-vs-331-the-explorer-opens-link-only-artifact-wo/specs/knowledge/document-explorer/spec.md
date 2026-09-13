## ADDED Requirements

### Requirement: The explorer's content panes carry no Close control

On a desktop viewport the explorer's content pane SHALL NOT render a Close control in any of its
panels — document, hub, archive or artifact. At rest the pane already falls back to the project's
`PROJECT.md`, so closing a selection is not a meaningful action. The same panel components, where
they are reused outside the explorer and closing is still meaningful, SHALL render a Close control
only when their caller supplies a close handler. The narrow-viewport control that returns to the
tree SHALL remain, since it is the only way back to the tree on a phone.

#### Scenario: A document is open on a desktop viewport
- **WHEN** a user opens a document, hub, archive file or artifact in the explorer at a desktop
  viewport width
- **THEN** the content pane shows its content with no Close button

#### Scenario: A shared panel outside the explorer still closes
- **WHEN** a document or hub panel is rendered outside the explorer with a close handler
- **THEN** its Close control is present and invokes that handler

#### Scenario: The phone back-to-tree control survives
- **WHEN** a user selects an entry at a narrow viewport and wants to return to the tree
- **THEN** the `← tree` control is present and returns the explorer to the tree
