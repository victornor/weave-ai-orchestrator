# project-overview/reserved-sections Specification

## Purpose
Describes the two sections the project overview holds open for the commit graph and the pull-request
viewer before either exists — that they are present, named and honest about being empty, and that
every section of the page is rendered against one contract, so a later change supplies a section's
content without reshaping the page.

## Requirements

### Requirement: Every section of the overview is rendered against one contract

Each section of the project overview SHALL be presented the same way: a stable name, a heading, an
address that can be linked to, and on a phone a control that collapses and expands it. A section's
content SHALL be supplied separately from that presentation, and SHALL be given the project it is
about and the workspace it belongs to.

Adding a section's content SHALL NOT require the page's layout, its ordering or any other section to
change.

#### Scenario: A section is addressable

- **WHEN** the overview is opened at the address of one of its sections
- **THEN** that section is the one brought into view

#### Scenario: Sections keep their order

- **WHEN** a section that had no content is given content
- **THEN** the page's other sections keep their order and their behaviour
