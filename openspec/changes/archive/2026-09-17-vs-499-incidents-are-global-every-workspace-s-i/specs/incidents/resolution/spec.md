## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Resolution is scoped like every other incident read

**Reason**: Incident reads are no longer scoped to the caller's workspace (see
`incidents/conductor-read`), and resolution must not stay stricter than the read it acts on: the
workspace that owns Weave AI has to close the incidents other workspaces file. The caller's workspace
is still recorded — now as `resolvedByWorkspaceId` — so the audit trail keeps the distinction between
where an incident was filed and where it was resolved.

**Migration**: None. A resolve that previously returned `forbidden` for another workspace's incident
now succeeds and records the resolving workspace; resolving an unknown id is still `not_found`.
