## ADDED Requirements

### Requirement: A dispatch label or worker chip shows its work's project colour

A dispatch label, and an unattributed worker chip shown below the conversation, SHALL show the
colour of the project (`workspace-navigation/project-colour`) that the underlying ticket — or, for
a chip standing for an agent with no ticket, the agent — belongs to. The status glyph already
carried by the label or chip SHALL remain the leftmost, primary signal; the project colour SHALL be
an additional marker, not a replacement for it.

Work that has no project associated with it SHALL show no colour marker, rather than a neutral or
placeholder one.

#### Scenario: A dispatch for a project's ticket

- **WHEN** a dispatch label is shown for a ticket that belongs to a project
- **THEN** the label shows that project's colour alongside its existing status glyph

#### Scenario: A dispatch with no project

- **WHEN** a dispatch label is shown for a ticket that belongs to no project
- **THEN** the label shows no colour marker

#### Scenario: An unattributed worker chip

- **WHEN** a worker chip is shown below the conversation for an agent whose project is known
- **THEN** the chip shows that project's colour

#### Scenario: Two dispatches from different projects are told apart

- **WHEN** two dispatch labels are shown for tickets belonging to two different projects
- **THEN** each label shows its own ticket's project colour, distinguishable from the other
