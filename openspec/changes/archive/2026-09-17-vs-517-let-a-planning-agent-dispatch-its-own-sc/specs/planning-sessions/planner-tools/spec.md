## MODIFIED Requirements

### Requirement: The planner can never create a real ticket

The planning agent SHALL NOT be able to create, transition, or otherwise mutate a real ticket, at any
point in its conversation, with exactly one narrow exception: dispatching a `scout` draft belonging to
its own `drafting` plan (`planning-sessions/scout-dispatch`), which creates a ticket for that draft
alone. That exception SHALL NOT extend to any other draft kind, any other plan, or any action on the
ticket once created — the planning agent has no tool that transitions, comments on, or otherwise
mutates a ticket after dispatch, and dispatching is never a side effect of any other planner action
(adding, editing, removing or reordering a draft).

#### Scenario: No ticket-creation tool is available to the planner

- **WHEN** the planning agent's available tools are listed
- **THEN** the tool that creates an arbitrary real ticket (`weave_ticket_create`) is not present

#### Scenario: Drafting a ticket-shaped item never creates a real ticket

- **WHEN** the planning agent adds, edits, or reorders a draft in its plan
- **THEN** no real ticket is created, transitioned, or otherwise changed as a side effect

#### Scenario: Dispatching a scout draft is the one action that creates a real ticket

- **WHEN** the planning agent dispatches a `scout` draft belonging to its own `drafting` plan
- **THEN** a real ticket is created for that draft, and this is the only tool call available to the
  planning agent that has that effect

#### Scenario: The planner has no further capability over a ticket once dispatched

- **WHEN** a planning agent's available tools are listed
- **THEN** no tool that transitions, comments on, assigns, or otherwise mutates an existing ticket is
  present, including the ticket created by its own dispatch
