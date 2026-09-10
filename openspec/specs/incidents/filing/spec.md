# incidents/filing Specification

## Purpose
Lets a conductor or worker file a durable AgentConductor system incident through MCP, so a failure is recorded instead of vanishing into a transcript or a chat aside.

## Requirements

### Requirement: An agent can file an incident through MCP

The daemon SHALL expose an MCP tool named `ac_incident` to every agent (conductor and worker). The tool SHALL accept a short `title`, `whatFailed` (what broke), `tryingToDo` (what the agent was attempting), and optional `evidence` (error text, tool name, or other detail). Empty `title`, `whatFailed`, or `tryingToDo` SHALL be rejected with `validation`. The tool SHALL persist a record and return `{ ok: true, data: { id, createdAt, reporterKind } }`.

The tool SHALL NOT be conductor-only. A worker SHALL be able to file an incident on its own run.

#### Scenario: A worker files an incident

- **WHEN** a worker calls `ac_incident` with a title, whatFailed, and tryingToDo
- **THEN** the tool returns `ok: true` with an `id` and `createdAt`
- **AND** a later list of incidents includes that record

#### Scenario: A conductor files an incident

- **WHEN** a conductor calls `ac_incident` with a title, whatFailed, and tryingToDo
- **THEN** the tool returns `ok: true` with an `id` and `createdAt`
- **AND** a later list of incidents includes that record

#### Scenario: Empty required fields are rejected

- **WHEN** an agent calls `ac_incident` with an empty title
- **THEN** the tool returns `ok: false` with code `validation`
- **AND** no incident record is stored

### Requirement: Reporter kind is the agent's kind

The stored record SHALL set `reporterKind` to `conductor` or `worker` from the filing run's agent kind. The tool SHALL NOT accept a caller-supplied reporter kind. A worker's file SHALL never be stored as a conductor incident, and a conductor's file SHALL never be stored as a worker incident.

The record SHALL also store the filing run's workspace id, agent id, and run id, and SHALL store ticket id and project id when the run has them.

#### Scenario: A worker cannot file as a conductor

- **WHEN** a worker calls `ac_incident`
- **THEN** the stored record's `reporterKind` is `worker`

#### Scenario: A conductor cannot file as a worker

- **WHEN** a conductor calls `ac_incident`
- **THEN** the stored record's `reporterKind` is `conductor`

#### Scenario: Run context is stored

- **WHEN** a worker on a ticket in a project files an incident
- **THEN** the stored record includes that worker's workspace id, agent id, run id, ticket id, and project id

### Requirement: Filing an incident is not a ticket

Calling `ac_incident` SHALL NOT create a ticket, SHALL NOT create a decision, and SHALL NOT post a message on a conductor thread. The incident is a system report. Existing ticket, Needs you, and chat behaviour SHALL be unchanged by a successful file.

#### Scenario: Filing does not open a ticket

- **WHEN** an agent calls `ac_incident` successfully
- **THEN** the project's ticket list is unchanged
- **AND** no new decision is open
- **AND** no new conductor-thread message is posted

### Requirement: Incident records persist at the daemon

An incident SHALL be stored in the daemon-level database, not in a workspace database, so the global Incidents page can list every file without querying each workspace. Two successful calls SHALL produce two records, even when title and body match. Records SHALL NOT be deleted or closed by this capability.

A session-authenticated client SHALL list incidents newest first via a daemon-level HTTP GET, optionally filtered by `reporterKind`. A run token SHALL NOT be accepted on that list route.

#### Scenario: Two files are two records

- **WHEN** an agent calls `ac_incident` twice with the same title and body
- **THEN** both records exist and have distinct ids

#### Scenario: The list is daemon-wide

- **WHEN** a worker in workspace Alpha files an incident and a conductor in workspace Beta files another
- **THEN** a session GET of the incidents list returns both, newest first

#### Scenario: A run token cannot list incidents

- **WHEN** a request to the incidents list carries only a run token
- **THEN** the request is rejected as unauthorized
