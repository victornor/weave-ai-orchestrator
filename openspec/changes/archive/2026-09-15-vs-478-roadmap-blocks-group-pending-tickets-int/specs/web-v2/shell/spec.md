## ADDED Requirements

### Requirement: The project Roadmap page is an addressable V2 destination

The V2 route table SHALL serve the project Roadmap page at `/w/$ws/p/$project/roadmap` as a sibling
of the project overview, and opening it SHALL render the V2 shell with a header that names the
project and the Roadmap destination. The route SHALL be reachable from the project overview's
Roadmap section and from the project's Roadmap sub-link in the rail and the phone More list, and its
address SHALL contain no `/v2` segment.

#### Scenario: The roadmap address resolves

- **WHEN** `/w/<workspace>/p/<project>/roadmap` is opened
- **THEN** the V2 shell renders the project's Roadmap page with a header naming the project and
  Roadmap

#### Scenario: The link reaches it

- **WHEN** the project's Roadmap sub-link or the overview section's link is activated
- **THEN** the project's Roadmap page opens

#### Scenario: A deep link

- **WHEN** the roadmap address is opened directly, without visiting the app root first
- **THEN** the page renders with the shell and no redirect through another address
