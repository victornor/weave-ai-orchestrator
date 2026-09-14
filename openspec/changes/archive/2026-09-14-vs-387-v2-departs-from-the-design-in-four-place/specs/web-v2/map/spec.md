## ADDED Requirements

### Requirement: A node's shape says its kind

Each node SHALL render the shape its kind owns, so a node is readable without its label: a
**workspace** SHALL be a circle, a **project** SHALL be a square, and a **worker** SHALL be a
triangle. The shape SHALL be drawn in the node's existing colour — a worker by its status, a project
and workspace by their hue — and changing the shape SHALL NOT change a node's hit area, its label,
its tooltip or the screen it opens.

#### Scenario: A workspace is a circle

- **WHEN** a workspace node renders
- **THEN** it is drawn as a circle

#### Scenario: A project is a square

- **WHEN** a project node renders
- **THEN** it is drawn as a square

#### Scenario: A worker is a triangle

- **WHEN** a worker node renders
- **THEN** it is drawn as a triangle

#### Scenario: Shape does not change what a node does

- **WHEN** the human activates a node of any kind
- **THEN** it opens the screen its kind owns, exactly as before the shape change
