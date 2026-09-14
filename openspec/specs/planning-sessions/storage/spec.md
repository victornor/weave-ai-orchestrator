# planning-sessions/storage Specification

## Purpose
Defines the persistent record of a captain's draft plan — a project-scoped, pre-ticket planning
session and its ordered list of draft tickets — so that closing and reopening the planning modal
always resumes the same conversation and the same list, never a fresh one and never a second one.

## Requirements

### Requirement: A project has at most one draft plan in progress at a time

The system SHALL allow a project to have at most one plan in the `drafting` status at any time.
Starting a planning session against a project that already has a `drafting` plan SHALL resume that
plan rather than create a second one.

#### Scenario: Opening the modal on a project with no draft plan starts one

- **WHEN** captain opens the Plan modal for a project with no `drafting` plan
- **THEN** a new plan is created scoped to that project, in `drafting` status, with an empty draft list

#### Scenario: Opening the modal on a project with an existing draft plan resumes it

- **WHEN** captain opens the Plan modal for a project that already has a `drafting` plan
- **THEN** the existing plan's conversation history and draft list are returned, unchanged, and no
  second plan is created

#### Scenario: A submitted or discarded plan does not block starting a new one

- **WHEN** captain opens the Plan modal for a project whose only prior plans are `submitted` or
  `discarded`
- **THEN** a new plan is created in `drafting` status, and the prior plans remain as history

### Requirement: A draft plan persists across the modal closing and reopening

The system SHALL persist a plan's conversation and its draft list independently of whether the
planning modal is open. Closing the modal SHALL NOT discard or alter the plan.

#### Scenario: Reopening after closing shows the same state

- **WHEN** captain closes the Plan modal with a `drafting` plan containing drafts, then reopens it
  later
- **THEN** the same conversation history and the same drafts, in the same order, are shown

### Requirement: A draft ticket carries the fields needed to create a real ticket from it

Each draft in a plan SHALL carry: a title, a description, a kind (one of `change`, `task`, `scout`,
`operational`), a priority, a position determining its order in the list, zero or more dependencies on
other drafts in the same plan, a target role, and a suggested tier. A draft SHALL also carry an
optional tier override, distinct from the suggested tier, that takes precedence over it when set. A
draft SHALL NOT carry any explanatory text for its suggested tier — the tier value is the whole of it.

#### Scenario: A newly added draft has all required fields

- **WHEN** a draft is added to a plan with a title, description, kind, priority and target role
- **THEN** the stored draft carries all of those fields, plus its position in the list and no tier
  override

#### Scenario: A tier override takes precedence over the suggested tier

- **WHEN** a draft has a suggested tier of `standard` and captain sets a tier override of `deep`
- **THEN** the draft's effective tier (the one used if a ticket is created from it) is `deep`, and the
  original suggested tier remains visible on the draft alongside the override

### Requirement: A dependency between two drafts in the same plan cannot form a cycle

The system SHALL reject an attempt to make one draft in a plan depend on another draft whose own
dependencies (transitively) already include the first.

#### Scenario: A direct cycle is rejected

- **WHEN** draft A already depends on draft B, and an edit attempts to make draft B depend on draft A
- **THEN** the edit is rejected and neither draft's dependencies change

#### Scenario: An indirect cycle is rejected

- **WHEN** draft A depends on draft B, and draft B depends on draft C, and an edit attempts to make
  draft C depend on draft A
- **THEN** the edit is rejected and no draft's dependencies change

### Requirement: The planning agent runs on the weaver's own model and runtime

The system SHALL run a planning agent on the same model and runtime configured for the weaver, not on
a separate worker-tier option. There SHALL NOT be a separate, per-workspace setting for the planning
agent's model. When the weaver's configured model or runtime changes, a planning agent's subsequent
turns SHALL use the new setting.

#### Scenario: The planner uses the weaver's configured model

- **WHEN** a planning agent takes a turn
- **THEN** it runs on the model and runtime currently configured for the weaver, not a `deep` or any
  other worker-tier option

#### Scenario: A change to the weaver's model reaches the planner

- **WHEN** the workspace's configured weaver model is changed, and a planning agent (for an existing
  or a new plan) takes a turn afterward
- **THEN** that turn runs on the newly configured model

### Requirement: A planning agent reads from an isolated, disposable checkout, never the project's shared clone

Each planning agent SHALL read the project's repository from its own checkout, provisioned when the
plan starts and removed when the plan ends. It SHALL NOT read from, or share, the project's ordinary
shared clone used for fetching and for workers' own delivery.

#### Scenario: A planning agent's checkout is separate from the shared clone

- **WHEN** a planning agent is provisioned for a new plan
- **THEN** it receives its own checkout of the project's repository, distinct from the project's
  shared clone

#### Scenario: The checkout is removed when the plan ends

- **WHEN** a plan is submitted or discarded
- **THEN** its planning agent's checkout is removed

### Requirement: A draft records whether and how it became a real ticket

Once a plan is submitted, each of its drafts SHALL end up in exactly one of: still pending, linked to
the real ticket created from it, or recorded as failed with a stated reason. A draft SHALL NOT be
silently dropped with no trace of what happened to it.

#### Scenario: A draft that becomes a ticket is linked to it

- **WHEN** a real ticket is created from a draft after submission
- **THEN** that draft is recorded as linked to the created ticket's identifier

#### Scenario: A draft that cannot become a ticket records why

- **WHEN** a draft cannot be turned into a real ticket after submission (for example, no role fits)
- **THEN** that draft is recorded as failed, together with the stated reason, and remains visible in
  the plan
