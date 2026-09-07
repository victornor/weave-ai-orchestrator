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

### Requirement: The overview reserves a History section

The project overview SHALL contain a section named "History", in its published order, whether or not
anything renders a commit history yet.

Until a commit history is rendered, the section SHALL state that the project's commit graph and its
branches will appear there. It SHALL NOT show sample commits, sample branches, a loading state or an
error.

#### Scenario: Before the history exists

- **WHEN** a project's overview is shown and no commit history is implemented
- **THEN** a section named History is present and says that the project's commit graph and branches
  will appear there

#### Scenario: Nothing is invented

- **WHEN** the reserved History section is shown
- **THEN** it shows no commit, no branch, no spinner and no error

### Requirement: The overview reserves a Pull requests section

The project overview SHALL contain a section named "Pull requests", in its published order, whether
or not anything lists pull requests yet.

Until pull requests are listed, the section SHALL state that the project's pull requests, with their
tickets and spec changes, will appear there. It SHALL NOT show sample pull requests, a loading state
or an error.

#### Scenario: Before the viewer exists

- **WHEN** a project's overview is shown and no pull-request viewer is implemented
- **THEN** a section named Pull requests is present and says that the project's pull requests with
  their tickets and spec changes will appear there

#### Scenario: Nothing is invented

- **WHEN** the reserved Pull requests section is shown
- **THEN** it shows no pull request, no spinner and no error
