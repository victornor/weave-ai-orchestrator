# role-management — delta

## MODIFIED Requirements

### Requirement: A role's persistent session is reachable from the role's surface

Each role SHALL expose an entry point that opens that role's persistent session — creating it on first use and resuming it on every later use. That entry point SHALL be present on the project overview, listing the roles of that project; SHALL remain on the roles screen; and SHALL be present in the shell's own navigation, as a child row under that role's project in the desktop rail and the phone More list. Every entry point SHALL call the same open-or-resume operation. The entry point SHALL be distinct from starting an ordinary ticket-bound interactive session: opening the persistent session SHALL NOT require or create a ticket.

The entry point SHALL state whether it will open an existing conversation or start a new one, so that resuming and starting are never presented as the same action. A role that cannot serve a persistent session — one whose status is not `active` — SHALL NOT offer the entry point and SHALL state why instead.

#### Scenario: Opening a role's persistent session from the project surface

- **WHEN** a human uses a role's session entry point on the project's role surface
- **THEN** the role's persistent session opens, with no ticket required or created

#### Scenario: Opening a role's persistent session from the shell's navigation

- **WHEN** a human uses a role's session row under its project in the rail or the phone More list
- **THEN** the role's persistent session opens, with no ticket required or created, and its conversation is shown

#### Scenario: The entry point resumes rather than duplicates

- **WHEN** a human uses the role's session entry point a second time
- **THEN** the same persistent session is opened, not a second one

#### Scenario: Starting and resuming are named apart

- **WHEN** a role's persistent session already exists, or does not exist yet
- **THEN** the entry point says it will open the existing conversation in the first case and start a new one in the second

#### Scenario: A role that cannot serve a session does not offer one

- **WHEN** a role is paused, retired or awaiting hire approval
- **THEN** its row offers no session entry point and states the reason
