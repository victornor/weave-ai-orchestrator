## MODIFIED Requirements

### Requirement: A dispatch label or worker chip shows its work's project colour

A dispatch label, and an unattributed worker chip shown below the conversation, SHALL colour
identifying text with the colour of the project (`workspace-navigation/project-colour`) that the
underlying ticket — or, for a chip standing for an agent with no ticket, the agent — belongs to.
On a dispatch label the coloured text SHALL be the ticket identifier. On a worker chip the
coloured text SHALL be the worker name. Neither SHALL show a separate project-colour circle.

The status glyph already carried by the label or chip SHALL remain the leftmost, primary signal;
the project colour SHALL be the colour of that identifying text, not a replacement for the glyph.

Work that has no project associated with it SHALL leave the identifying text in its default
colour, rather than a neutral or placeholder tint, and SHALL show no colour circle.

#### Scenario: A dispatch for a project's ticket

- **WHEN** a dispatch label is shown for a ticket that belongs to a project
- **THEN** the ticket identifier is shown in that project's colour, with no project-colour circle,
  alongside its existing status glyph

#### Scenario: A dispatch with no project

- **WHEN** a dispatch label is shown for a ticket that belongs to no project
- **THEN** the ticket identifier is not tinted with a project colour, and the label shows no
  colour circle

#### Scenario: An unattributed worker chip

- **WHEN** a worker chip is shown below the conversation for an agent whose project is known
- **THEN** the worker name is shown in that project's colour, with no project-colour circle

#### Scenario: Two dispatches from different projects are told apart

- **WHEN** two dispatch labels are shown for tickets belonging to two different projects
- **THEN** each label shows its own ticket identifier in that ticket's project colour,
  distinguishable from the other
