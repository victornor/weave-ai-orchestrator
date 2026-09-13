## MODIFIED Requirements

### Requirement: Nodes are workspaces, projects, roles, in-flight tickets and knowledge

The graph SHALL include, for each hosted workspace that has loaded:

- one **workspace** node, named with the workspace's name;
- one **project** node per project in that workspace, named with the project's display label (its
  name, falling back to its slug);
- one **conductor** node for that workspace's conductor, when the conductor exists;
- one **role** node per hired role that is not `retired`, named with the role's name, including
  roles whose status is `pending_activation` or `paused`;
- one **ticket** node per in-flight ticket, named with the ticket's identifier and title.
  In-flight means the ticket's status is one of `proposing`, `proposed`, `approved`, `in_progress`,
  `in_review`, `merging`, or `blocked`. Tickets in `backlog`, `todo`, `done` or `cancelled` SHALL
  NOT have a node;
- one **knowledge** node per project that has at least one knowledge file, and one knowledge node
  for workspace-scope knowledge when that workspace has knowledge files that belong to no project.
  A knowledge node SHALL represent that project's (or the workspace's) knowledge as a whole, not
  each document.

Workers SHALL NOT be nodes. A ticket that a live worker currently holds MAY name that worker on the
ticket node, but the worker is not a separate node.

Each node kind SHALL be distinguishable by shape or colour from the other kinds, using the app's
design tokens.

#### Scenario: A workspace with a project, a role and a running ticket

- **WHEN** workspace Alpha has project `api`, a hired role "Platform Engineer" on that project, and
  ticket VS-176 in `in_progress` assigned to that role
- **THEN** the graph contains nodes for Alpha, `api`, the role, and VS-176

#### Scenario: A todo ticket is not on the map

- **WHEN** a ticket in any hosted workspace is in `todo`
- **THEN** that ticket has no node on the global Map

#### Scenario: A done ticket is not on the map

- **WHEN** a ticket in any hosted workspace is in `done`
- **THEN** that ticket has no node on the global Map

#### Scenario: Knowledge is one node per project, not every document

- **WHEN** project `api` has a hub file and three documents
- **THEN** the graph has one knowledge node for `api`, not four

#### Scenario: A worker is not a node

- **WHEN** a live worker holds an in-flight ticket
- **THEN** the graph has a node for the ticket and for the role, and no node for the worker

#### Scenario: A retired role is not a node

- **WHEN** a role in any hosted workspace is `retired`
- **THEN** that role has no node on the global Map
