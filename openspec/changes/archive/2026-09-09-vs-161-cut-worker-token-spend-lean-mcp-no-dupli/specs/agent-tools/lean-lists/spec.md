## Purpose

Keeps AgentConductor MCP list-tool payloads small by default so a worker listing tickets (or similar collections) does not pull every description or document body into the conversation.

## ADDED Requirements

### Requirement: MCP list tools return a lean projection by default

An MCP list tool SHALL return identifiers and routing fields (id, identifier, status, kind, title, summary, priority, timestamps, foreign keys) and SHALL NOT include free-text bodies such as ticket `description`, document `body`, or role charter text, unless the call sets an explicit include flag. `ac_ticket_list` is the required instance of this rule. `ac_ticket_get` and other get-by-id tools SHALL continue to return the full entity, including `description` and document bodies.

#### Scenario: Default ticket list has no descriptions

- **WHEN** an agent calls `ac_ticket_list` without `includeDescription`
- **THEN** each item has `id`, `identifier`, `status`, `kind`, and `title`
- **AND** no item includes a `description` field

#### Scenario: Get still returns the body

- **WHEN** an agent calls `ac_ticket_get` for a ticket that has a description
- **THEN** the result includes that ticket's `description`

#### Scenario: Explicit include restores descriptions on the list

- **WHEN** an agent calls `ac_ticket_list` with `includeDescription: true`
- **THEN** each item includes `description`

### Requirement: HTTP ticket list is unchanged

Session-authenticated `GET /tickets` SHALL continue to return full ticket rows including `description`. Slimming applies to the MCP tool (and the agent-tool HTTP POST that invokes it), not the UI list.

#### Scenario: Web list still has descriptions

- **WHEN** a session client calls `GET /tickets`
- **THEN** listed tickets include `description` when the ticket has one

### Requirement: MCP list results are size-capped

The MCP encoding of a list-tool result SHALL NOT exceed 64 KiB of JSON text. When a result would exceed that, the tool SHALL return a truncated payload that includes `truncated: true` and enough identifiers for the agent to follow up with get-by-id. Get-by-id tool results SHALL NOT be truncated by this cap.

#### Scenario: An oversized list is marked truncated

- **WHEN** an MCP list tool's JSON would exceed 64 KiB
- **THEN** the returned text is at most 64 KiB
- **AND** the parsed payload has `truncated: true`

#### Scenario: A single ticket get is not capped

- **WHEN** `ac_ticket_get` returns a ticket whose description alone is larger than 64 KiB
- **THEN** the MCP result includes the full description
- **AND** the payload is not marked `truncated`
