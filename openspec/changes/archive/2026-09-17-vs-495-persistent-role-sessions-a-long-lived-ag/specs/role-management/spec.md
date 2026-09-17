## ADDED Requirements

### Requirement: A role's persistent session is reachable from the role's surface

Each role SHALL expose an entry point, on the project's role surface, that opens that role's persistent session — creating it on first use and resuming it on every later use. This entry point SHALL be distinct from starting an ordinary ticket-bound interactive session: opening the persistent session SHALL NOT require or create a ticket.

#### Scenario: Opening a role's persistent session from the project surface

- **WHEN** a human uses the role's session entry point on the project's role surface
- **THEN** the role's persistent session opens, with no ticket required or created

#### Scenario: The entry point resumes rather than duplicates

- **WHEN** a human uses the role's session entry point a second time
- **THEN** the same persistent session is opened, not a second one
