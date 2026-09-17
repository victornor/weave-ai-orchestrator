# incidents/resolution Specification

## Purpose
Lets a conductor record that a filed incident was reviewed and dealt with — who did it, why, and
optionally which ticket fixed the cause — so a repeating review sweep does not re-litigate the same
row forever. Workers gain no resolve access, and resolution is never inferred from other activity.

## Requirements

### Requirement: A conductor can resolve an incident through MCP

The daemon SHALL expose an MCP tool named `weave_incident_resolve` to the conductor only. It SHALL
accept the incident `id`, a required `resolution` (1-2000 characters after trimming) explaining why
the incident is resolved, and MAY accept an optional `ticketId` naming the ticket that fixed the
cause. On success it SHALL record `resolvedAt` (the current instant), `resolvedByAgentId` (the
calling agent), `resolvedByWorkspaceId` (the workspace the calling run belongs to), the `resolution`
text, and the `ticketId` when given, and SHALL return the updated incident. The incident MAY belong
to any workspace; the caller's own workspace SHALL NOT restrict which incident it may resolve.

`ticketId` SHALL be stored as given and SHALL NOT be validated against an existing ticket: an incident
is often fixed by work that never files a ticket naming it, and resolution must not depend on that
reference being correct or even present.

#### Scenario: Resolving a filed incident

- **WHEN** a conductor calls `weave_incident_resolve` with the id of an open incident and a resolution
- **THEN** the tool returns `{ ok: true, data: <incident> }` with `resolvedAt` set and `resolution` stored
- **AND** a later `weave_incident_get` for that id returns the same `resolvedAt`, `resolution` and `resolvedByAgentId`

#### Scenario: Resolution can name the fixing ticket

- **WHEN** a conductor resolves an incident and passes `ticketId`
- **THEN** the stored incident's `resolutionTicketId` is that id
- **AND** it is stored even when no ticket with that id exists

#### Scenario: Resolution requires a reason

- **WHEN** a conductor calls `weave_incident_resolve` with an empty or all-whitespace `resolution`
- **THEN** the tool returns `{ ok: false, error: { code: "validation" } }`
- **AND** the incident's `resolvedAt` stays null

#### Scenario: Resolving another workspace's incident keeps both workspaces

- **WHEN** a conductor of workspace B resolves an incident filed from workspace A
- **THEN** the tool returns `{ ok: true, data: <incident> }` with `resolvedAt` set and `resolvedByWorkspaceId` naming B, the workspace it was resolved from
- **AND** the stored incident's `workspaceId` still names A, where it was filed

### Requirement: An already-resolved incident cannot be resolved again

Calling `ac_incident_resolve` on an incident whose `resolvedAt` is already set SHALL be rejected with
`wrong_status` and SHALL NOT change the incident's existing `resolvedAt`, `resolvedByAgentId`,
`resolution` or `resolutionTicketId`.

#### Scenario: Re-resolving is refused

- **WHEN** a conductor calls `ac_incident_resolve` on an incident that was already resolved
- **THEN** the tool returns `{ ok: false, error: { code: "wrong_status" } }`
- **AND** the incident's original `resolvedAt` and `resolution` are unchanged

### Requirement: Workers cannot resolve incidents

`ac_incident_resolve` SHALL NOT be available to a worker: a worker's call SHALL be rejected with
`forbidden`. A worker's ability to file incidents through `ac_incident` SHALL be unchanged.

#### Scenario: A worker cannot resolve

- **WHEN** a worker calls `ac_incident_resolve` with the id of an incident it filed itself
- **THEN** the tool returns `{ ok: false, error: { code: "forbidden" } }`
- **AND** the incident's `resolvedAt` stays null

### Requirement: Resolution is never inferred automatically

The daemon SHALL NOT resolve an incident as a side effect of any other action — a ticket transitioning
to `done`, a merge, or a ticket's description or comments naming the incident's id. Resolution SHALL
only happen through an explicit `ac_incident_resolve` call.

#### Scenario: Landing a ticket does not resolve an incident

- **WHEN** a ticket whose description names an incident's id is transitioned to `done` and merged
- **THEN** that incident's `resolvedAt` remains null until a separate `ac_incident_resolve` call
