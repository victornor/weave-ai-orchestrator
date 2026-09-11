## MODIFIED Requirements

### Requirement: Filing a ticket can name a worker option

Creating a ticket SHALL accept an optional worker-option id. Assigning a ticket to a role SHALL
also accept one, but only while that ticket has no worker. Once a worker has been spawned for
the ticket, create, assign, HTTP, and the CLI SHALL NOT change the stored id. The one exception
SHALL be the human answering a usage-limit parking decision with a catalog option that was
offered on that card: that answer SHALL store that option's id on the ticket so the next turn
runs on it.

When the id is omitted, the ticket SHALL store none and its worker SHALL use the effective
workers setting. When the id is supplied, it SHALL match an option in the effective catalog
(the daemon catalog overlay if filled, otherwise the workspace catalog) at the moment of the
write; otherwise the write SHALL be rejected rather than storing an unknown id or falling back
silently. A request SHALL NOT accept a raw runtime, model or effort on a ticket — only a
catalog option id.

The same fields SHALL be available on the HTTP create and assign paths that humans use, and on
the CLI create command.

#### Scenario: Create with a known option stores it

- **WHEN** a ticket is created with a worker-option id that exists in the catalog
- **THEN** that id is stored on the ticket

#### Scenario: Create without an option uses the default

- **WHEN** a ticket is created with no worker-option id
- **THEN** the ticket stores none, and its worker runs on the workers setting

#### Scenario: An unknown option id is rejected at write time

- **WHEN** a ticket is created or assigned with a worker-option id that is not in the catalog
- **THEN** the write is rejected and no ticket is stored with that id

#### Scenario: Assign can set the option before spawn

- **WHEN** a ticket that has no worker is assigned with a worker-option id that exists in the
  catalog
- **THEN** that id is stored on the ticket before the worker is spawned

#### Scenario: The option cannot be changed after spawn

- **WHEN** a ticket already has a worker and a create, assign, HTTP, or CLI request tries to
  change its worker-option id
- **THEN** the request is rejected and the stored id is left unchanged

#### Scenario: A usage-limit card can move the ticket to another catalog option

- **WHEN** a ticket already has a worker and the human answers that worker's usage-limit parking
  decision with a catalog option that was offered on the card
- **THEN** that option's id is stored on the ticket
- **AND** the existing worktree, branch and commits are kept
