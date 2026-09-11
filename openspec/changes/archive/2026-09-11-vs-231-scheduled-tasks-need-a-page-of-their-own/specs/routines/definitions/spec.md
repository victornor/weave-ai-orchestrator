## MODIFIED Requirements

### Requirement: Captain can list, add, pause, resume and remove routines

A session-authenticated client SHALL list this workspace's routines and SHALL create, pause, resume, edit and remove them over HTTP. The `conductor` CLI SHALL expose the same operations as `routine list|show|add|pause|resume|rm`. The conductor SHALL have MCP tools to list, create, update and remove routines; a worker SHALL NOT. The web Scheduled page SHALL list every workspace's routines, let captain add one on a named workspace, and let them pause, resume, edit or remove each. The workspace Settings SHALL NOT offer a Scheduled tasks section.

Empty list SHALL be a normal empty state, not an error.

#### Scenario: HTTP list is empty until one exists

- **WHEN** the workspace has no routines
- **THEN** listing them returns an empty list

#### Scenario: CLI pause matches HTTP pause

- **WHEN** captain pauses a routine with `conductor routine pause`
- **THEN** a subsequent HTTP list shows that routine as paused

#### Scenario: A worker cannot create a routine

- **WHEN** a worker calls the MCP tool that creates routines
- **THEN** the call is rejected
- **AND** no routine is stored

#### Scenario: Settings shows the workspace's routines

- **WHEN** captain opens the Scheduled page
- **THEN** they see this workspace's routines by name, schedule, enabled state and next due time, each attributed to this workspace
- **AND** they can add, pause, resume, edit or remove a routine from that page
