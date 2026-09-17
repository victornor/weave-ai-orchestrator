# model-selection/worker-options Specification (delta)

## MODIFIED Requirements

### Requirement: Filing a ticket can name a worker option

Creating a ticket SHALL accept a worker-option id. Assigning a ticket to a role SHALL also accept
one, but only while that ticket has no worker. Once a worker has been spawned for the ticket, create,
assign, HTTP, and the CLI SHALL NOT change the stored id. The one exception SHALL be the human
answering a usage-limit parking decision with a catalog option that was offered on that card: that
answer SHALL store that option's id on the ticket so the next turn runs on it.

When the id is supplied, it SHALL match an option in the effective catalog (the workspace's own
catalog when it is non-empty, otherwise the daemon catalog overlay if filled) at the moment of the
write; otherwise the write SHALL be rejected rather than storing an unknown id or falling back
silently. A rejection for an unknown id SHALL name the valid option ids. A request SHALL NOT accept a
raw runtime, model or effort on a ticket — only a catalog option id.

When the id is omitted, the outcome SHALL depend on who is choosing:

- On the agent-facing tools that file or route work — `weave_ticket_create`, a persistent session's
  ticket-taking tool, and role assignment that attaches a role to a ticket naming no worker option —
  the omission SHALL be refused as a `validation` error when the effective catalog holds at least one
  configured option. The refusal's message SHALL name every configured option with its description,
  so the next call can be an informed one rather than a retry with a guess.
- On the human HTTP and CLI create and assign paths, and on paths where no agent is choosing — a
  ticket filed by the system, such as the project-description scout, knowledge curation, or a
  workspace import — the omission SHALL store none, and the worker SHALL use the effective workers
  setting.
- When the effective catalog is empty, or every option in it is unconfigured, the omission SHALL
  also store none and the worker SHALL use the effective workers setting: a required field that
  cannot be satisfied would block all filing, which is worse than the default it replaces.

The same fields SHALL be available on the HTTP create and assign paths that humans use, and on the
CLI create command.

#### Scenario: Create with a known option stores it

- **WHEN** a ticket is created with a worker-option id that exists in the catalog
- **THEN** that id is stored on the ticket

#### Scenario: Create without an option uses the default

- **WHEN** a ticket is created with no worker-option id on a path that keeps the default — the human
  HTTP or CLI path, a system-filed ticket, or an empty or fully-unconfigured catalog
- **THEN** the ticket stores none, and its worker runs on the workers setting

#### Scenario: An agent create without an option is refused with the catalog

- **WHEN** `weave_ticket_create` is called with no worker-option id and the effective catalog holds
  at least one configured option
- **THEN** the call fails with a `validation` error whose message names every configured option id
  and its description
- **AND** no ticket is stored

#### Scenario: An agent create with a known option succeeds

- **WHEN** `weave_ticket_create` is called with a worker-option id that is a configured option in the
  effective catalog
- **THEN** the ticket is stored with that id

#### Scenario: An unknown option id is rejected at write time

- **WHEN** a ticket is created or assigned with a worker-option id that is not in the catalog
- **THEN** the write is rejected, no ticket is stored with that id, and the error names the valid
  option ids

#### Scenario: Assign can set the option before spawn

- **WHEN** a ticket that has no worker is assigned with a worker-option id that exists in the
  catalog
- **THEN** that id is stored on the ticket before the worker is spawned

#### Scenario: Assigning a role to a ticket with no option requires the choice

- **WHEN** `weave_ticket_assign` attaches a role to a ticket that names no worker option and the
  effective catalog holds at least one configured option
- **THEN** the call fails with a `validation` error naming the configured options, and the ticket is
  unchanged
- **AND** the same assign with a configured worker-option id succeeds

#### Scenario: A session taking a ticket requires the choice

- **WHEN** a persistent session's ticket-taking tool creates a new ticket with no worker-option id
  and the effective catalog holds at least one configured option
- **THEN** the call fails with a `validation` error naming the configured options
- **AND** the same call with a configured worker-option id succeeds

#### Scenario: An empty or fully-unconfigured catalog keeps the default

- **WHEN** an agent files a ticket with no worker-option id and the effective catalog is empty, or
  every option in it has no runtime chosen
- **THEN** the ticket is created and stores none, and its worker runs on the workers setting

#### Scenario: The option cannot be changed after spawn

- **WHEN** a ticket already has a worker and a create, assign, HTTP, or CLI request tries to
  change its worker-option id
- **THEN** the request is rejected and the stored id is left unchanged

#### Scenario: A usage-limit card can move the ticket to another catalog option

- **WHEN** a ticket already has a worker and the human answers that worker's usage-limit parking
  decision with a catalog option that was offered on the card
- **THEN** that option's id is stored on the ticket
- **AND** the existing worktree, branch and commits are kept
