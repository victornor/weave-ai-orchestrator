## MODIFIED Requirements

### Requirement: Opening a node reaches that thing in its workspace

Selecting a node SHALL mark it as selected and SHALL show a detail panel naming the node, its kind,
and its workspace. The panel SHALL offer an action that opens the thing the node represents, in
that thing's workspace. Double-clicking a node SHALL be a shortcut for that action.

Opening SHALL navigate within the running application without a document reload, and SHALL make
that workspace the active one — the human has left the global page.

- A workspace node SHALL open that workspace's Needs you page.
- A project node SHALL open that project's overview.
- A role node SHALL open that workspace's Roles page.
- A conductor node SHALL open that workspace's Chat page.
- A ticket node SHALL open that ticket.
- A knowledge node SHALL open that workspace's Knowledge page; a project knowledge node SHALL open
  it on that project.

Closing the panel SHALL clear the selection. Opening SHALL NOT edit knowledge.

#### Scenario: Opening a ticket from the map

- **WHEN** the human activates the open action on ticket VS-176's node, whose workspace is Alpha
- **THEN** the app shows VS-176 in Alpha and Alpha becomes the active workspace

#### Scenario: Opening a project from the map

- **WHEN** the human double-clicks project `api`'s node in workspace Alpha
- **THEN** the app shows `api`'s overview in Alpha

#### Scenario: Opening a role from the map

- **WHEN** the human opens a role node whose workspace is Alpha
- **THEN** the app shows Alpha's Roles page

#### Scenario: Knowledge is not edited from the map

- **WHEN** the human opens a knowledge node
- **THEN** the app shows that knowledge page and does not present an editor on the map itself
