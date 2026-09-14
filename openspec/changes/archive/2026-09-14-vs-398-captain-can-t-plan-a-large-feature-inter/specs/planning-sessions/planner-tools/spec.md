## Purpose

Defines the planning agent's boundaries: what it can read, what it can change, and the hard guarantee
that it can never take an action that reaches outside its own draft plan — no real ticket, no message
to a worker, no answered decision.

## ADDED Requirements

### Requirement: The planner reads the project, never writes to it, and the guarantee is enforced, not assumed

The planning agent SHALL be able to read the project's repository, knowledge base, specs, open
tickets and roles. It SHALL NOT be able to modify the repository in any way. This guarantee SHALL be
enforced by denying every write-capable action available to the agent's runtime for the entire
session, not only by the absence of a write-shaped tool from its MCP tool list.

#### Scenario: The planner can read project context

- **WHEN** the planning agent looks up open tickets, specs, knowledge documents or roles for its
  plan's project
- **THEN** it receives the current data for that project

#### Scenario: The planner has no path to edit the repository

- **WHEN** the planning agent's available tools are listed
- **THEN** no tool that writes to the project's repository (create, edit, commit, or open a pull
  request) is present

#### Scenario: An attempted file write or state-changing command is refused

- **WHEN** the planning agent's turn attempts to write a file or run a state-changing command through
  any capability its runtime would otherwise offer
- **THEN** the attempt is refused by the runtime itself, and no file in the project's repository
  changes as a result

### Requirement: The planner's reads are scoped to its own plan's project

The planning agent SHALL be able to read only the project its plan belongs to. It SHALL NOT be able to
read another project's tickets, specs, or project-scoped knowledge, and SHALL NOT be able to read
workspace-scoped or decision-scoped knowledge at all.

#### Scenario: Another project's tickets are not reachable

- **WHEN** the planning agent looks up tickets, and its plan belongs to project A
- **THEN** it can see project A's tickets and cannot see any ticket belonging to a different project

#### Scenario: Another project's specs are not reachable

- **WHEN** the planning agent looks up specs, and its plan belongs to project A
- **THEN** it can see project A's specs and cannot see specs belonging to a different project

#### Scenario: Workspace- and decision-scoped knowledge are never reachable

- **WHEN** the planning agent reads or searches knowledge
- **THEN** results are limited to its own project's knowledge and shared knowledge, and never include
  workspace-scoped or decision-scoped knowledge

### Requirement: The planner can never create a real ticket

The planning agent SHALL NOT be able to create, transition, or otherwise mutate a real ticket, at any
point in its conversation.

#### Scenario: No ticket-creation tool is available to the planner

- **WHEN** the planning agent's available tools are listed
- **THEN** the tool that creates a real ticket is not present

#### Scenario: Drafting a ticket-shaped item never creates a real ticket

- **WHEN** the planning agent adds, edits, or reorders a draft in its plan
- **THEN** no real ticket is created, transitioned, or otherwise changed as a side effect

### Requirement: The planner can never message a worker or answer a decision

The planning agent SHALL NOT be able to send a message to a worker or answer any decision, including
one raised on its own plan's project.

#### Scenario: No worker-messaging tool is available to the planner

- **WHEN** the planning agent's available tools are listed
- **THEN** the tool that sends a message to a worker is not present

#### Scenario: No decision-answering tool is available to the planner

- **WHEN** the planning agent's available tools are listed
- **THEN** the tool that answers a decision is not present

### Requirement: The planner can add, edit, remove and reorder drafts only in its own plan

The planning agent SHALL be able to add, edit, remove and reorder draft tickets, but only for the one
plan its own session belongs to. An attempt to act on any other plan SHALL be refused.

#### Scenario: Editing the planner's own plan succeeds

- **WHEN** the planning agent adds, edits, removes, or reorders a draft in the plan its session
  belongs to
- **THEN** the change is applied and reflected in that plan's draft list

#### Scenario: Acting on a different plan is refused

- **WHEN** the planning agent attempts to add, edit, remove, or reorder a draft against a plan other
  than the one its session belongs to
- **THEN** the action is refused and no change is made to that other plan

### Requirement: The planner can never submit its own plan

Only captain SHALL be able to submit a plan. The planning agent SHALL have no capability, tool, or
other path that submits a plan, under any circumstance.

#### Scenario: No submit capability is available to the planner

- **WHEN** the planning agent's available tools are listed
- **THEN** no tool that submits a plan is present, in any form

#### Scenario: Submitting is not reachable by any other planner action

- **WHEN** the planning agent adds, edits, removes, or reorders drafts, including bringing a plan to a
  state it considers ready
- **THEN** the plan remains in its drafting state until captain submits it directly; no sequence of
  planner actions submits it

### Requirement: The planner sees captain's edits

When captain edits a field of a draft directly (outside the conversation), the planning agent's view
of the plan on its next turn SHALL reflect that edit.

#### Scenario: A captain-made edit is visible to the planner's next turn

- **WHEN** captain changes a draft's tier override, role, or any other field directly, and the
  planning agent takes its next turn
- **THEN** the planning agent's view of the plan includes captain's change, not the value it last set
  itself
