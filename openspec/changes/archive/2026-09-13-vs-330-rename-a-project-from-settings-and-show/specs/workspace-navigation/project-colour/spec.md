## MODIFIED Requirements

### Requirement: Project colour is the identifying text, never a circle

A surface that shows a project's colour SHALL apply that colour to the identifying text for
that work — the project's display label where a project is named, the ticket identifier on a
dispatch label, the worker name on a worker chip. It SHALL NOT show a separate circle, disc,
dot, or swatch filled with the project colour. Status glyphs and sync-state markers that
already exist on those surfaces SHALL remain, and SHALL remain visually distinguishable from
the project-coloured text.

#### Scenario: Sidebar names the project in colour

- **WHEN** a sidebar group lists a project
- **THEN** that project's display label is shown in that project's colour, and no project-colour
  circle is shown on the row

#### Scenario: A composer project tag names the project in colour

- **WHEN** the chat's project selector renders a project's tag
- **THEN** the tag's label is shown in that project's colour, and the tag has no
  project-colour circle

#### Scenario: A dispatch label names the ticket in colour

- **WHEN** a dispatch label is shown for a ticket that belongs to a project
- **THEN** the ticket identifier is shown in that project's colour, and the label has no
  project-colour circle

#### Scenario: A worker chip names the worker in colour

- **WHEN** a worker chip is shown for an agent whose project is known
- **THEN** the worker name is shown in that project's colour, and the chip has no
  project-colour circle
